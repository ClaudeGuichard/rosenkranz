// Kleine Laufzeit, die die Entwurfsdateien (.dc.html) ohne Editor darstellt
(function () {
  var REG = {};          // name -> { tpl: DocumentFragment, cls: Component }
  var INST = {};         // key -> component instance
  var rootHost = null;
  var scheduled = false;

  window.DCLogic = function DCLogic() {};
  // Einstellungen dauerhaft merken (nur die freigegebenen Schlüssel)
  function storeKey(name) { return 'rosenkranz.v1.' + name; }
  function loadSaved(name, keys) {
    var out = {};
    if (!keys || !keys.length) return out;
    try {
      var raw = window.localStorage.getItem(storeKey(name));
      var obj = raw ? JSON.parse(raw) : {};
      keys.forEach(function (k) { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
    } catch (e) {}
    return out;
  }
  function save(inst) {
    var keys = inst.__persist;
    if (!keys || !keys.length) return;
    var obj = {};
    keys.forEach(function (k) { if (inst.state && inst.state[k] !== undefined) obj[k] = inst.state[k]; });
    try { window.localStorage.setItem(storeKey(inst.__name), JSON.stringify(obj)); } catch (e) {}
  }
  window.DCLogic.prototype.setState = function (u) {
    this.state = Object.assign({}, this.state || {}, u);
    save(this);
    schedule();
  };
  window.DCLogic.prototype.forceUpdate = function () { schedule(); };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () { scheduled = false; renderRoot(); });
  }

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    var head = parts[0], val;
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] && Object.prototype.hasOwnProperty.call(scopes[i], head)) { val = scopes[i][head]; break; }
    }
    for (var j = 1; j < parts.length && val != null; j++) val = val[parts[j]];
    return val;
  }
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  function interp(str, scopes) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : String(v); });
  }
  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function renderNodes(nodes, scopes, out, keyBase, used) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scopes, out, keyBase + '.' + i, used);
  }

  function renderNode(node, scopes, out, key, used) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scopes))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'sc-if') {
      var m = WHOLE.exec(node.getAttribute('value') || '');
      var cond = m ? lookup(m[1], scopes) : false;
      if (cond) renderNodes(node.childNodes, scopes, out, key, used);
      return;
    }
    if (tag === 'sc-for') {
      var lm = WHOLE.exec(node.getAttribute('list') || '');
      var list = lm ? lookup(lm[1], scopes) : [];
      var as = node.getAttribute('as') || 'item';
      (list || []).forEach(function (item, idx) {
        var sc = {}; sc[as] = item; sc.$index = idx;
        renderNodes(node.childNodes, scopes.concat([sc]), out, key + '[' + idx + ']', used);
      });
      return;
    }
    if (tag === 'dc-import') {
      var name = node.getAttribute('name');
      var props = {};
      for (var a = 0; a < node.attributes.length; a++) {
        var at = node.attributes[a];
        if (at.name === 'name' || at.name.indexOf('hint-') === 0) continue;
        var wm = WHOLE.exec(at.value);
        props[camel(at.name)] = wm ? lookup(wm[1], scopes) : interp(at.value, scopes);
      }
      var ik = name + '@' + key;
      used[ik] = true;
      var inst = INST[ik];
      if (!inst) { inst = create(name); INST[ik] = inst; }
      inst.props = props;
      renderComponent(REG[name], inst, out, ik, used);
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, tag) : document.createElement(tag);
    for (var b = 0; b < node.attributes.length; b++) {
      var att = node.attributes[b];
      var nm = att.name;
      if (nm.indexOf('on') === 0 && nm.length > 2) {
        var em = WHOLE.exec(att.value);
        var fn = em ? lookup(em[1], scopes) : null;
        if (typeof fn === 'function') el.addEventListener(nm.slice(2).toLowerCase(), (function (f) { return function (e) { f(e); }; })(fn));
        continue;
      }
      var whole = WHOLE.exec(att.value);
      var v = whole ? lookup(whole[1], scopes) : interp(att.value, scopes);
      if (v === false || v == null) continue;
      el.setAttribute(nm, v === true ? '' : String(v));
    }
    if (tag === 'a') {
      var href = el.getAttribute('href') || '';
      if (/\.dc\.html$/.test(href)) { el.setAttribute('href', '#'); el.addEventListener('click', function (e) { e.preventDefault(); }); }
    }
    renderNodes(node.childNodes, scopes, el, key, used);
    out.appendChild(el);
  }

  function create(name) {
    var def = REG[name];
    var inst = new def.cls();
    inst.__name = name; inst.__persist = def.persist;
    inst.state = loadSaved(name, def.persist);
    return inst;
  }

  function renderComponent(def, inst, out, key, used) {
    var vals = inst.renderVals();
    renderNodes(def.tpl.childNodes, [vals], out, key, used);
  }

  function renderRoot() {
    var used = {};
    var frag = document.createDocumentFragment();
    var root = INST.__root;
    renderComponent(REG[root.__name], root, frag, '__root', used);
    for (var k in INST) if (k !== '__root' && !used[k]) delete INST[k];
    rootHost.replaceChildren(frag);
  }

  window.DC = {
    register: function (name, tplId, cls, persist) {
      var t = document.getElementById(tplId);
      REG[name] = { tpl: t.content, cls: cls, persist: persist || [] };
    },
    mount: function (name, host) {
      rootHost = host;
      var inst = create(name);
      inst.props = {};
      INST.__root = inst;
      renderRoot();
    }
  };
})();
