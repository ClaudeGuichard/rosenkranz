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
    refresh: function () { if (INST.__root) schedule(); },
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

DC.register('Gebet', 'tpl-Gebet', (function () {

function pron(src, style) {
  var ACC = '́';
  var s = src.normalize('NFD');
  // tokens: letters with accent flag
  var out = '';
  var words = s.split(/(\s+|[,.:;!?„“"]+)/);
  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    if (!/[A-Za-z]/.test(w)) { out += w; continue; }
    var L = [];
    for (var i = 0; i < w.length; i++) {
      var ch = w[i];
      if (ch === ACC) { if (L.length) L[L.length - 1].acc = true; continue; }
      if (ch === '\u0308') { if (L.length) L[L.length - 1].hi = true; continue; }
      L.push({ c: ch.toLowerCase(), up: ch !== ch.toLowerCase(), acc: false });
    }
    var cap = L.length && L[0].up;
    var r = '';
    var isV = function (x) { return x && 'aeiouy'.indexOf(x.c) >= 0; };
    var front = function (k) { var x = L[k], y = L[k + 1]; if (!x) return false; if ('eiy'.indexOf(x.c) >= 0) return true; if ((x.c === 'a' || x.c === 'o') && y && y.c === 'e') return true; return false; };
    var a = function (txt, acc) { if (!acc) return txt; var m = txt.match(/[aeiouyäöü](?!.*[aeiouyäöü])/); if (!m) return txt + ACC; var p = txt.lastIndexOf(m[0]); return txt.slice(0, p + 1) + ACC + txt.slice(p + 1); };
    for (var k = 0; k < L.length; k++) {
      var x = L[k], n = L[k + 1], p = L[k - 1], c = x.c;
      if (c === 'c' && n && n.c === 'h') { r += 'k'; k++; continue; }
      if (c === 'p' && n && n.c === 'h') { r += 'f'; k++; continue; }
      if (c === 't' && n && n.c === 'h') { r += 't'; k++; continue; }
      if (c === 'h') { if (style === 'de') r += 'h'; continue; }
      if (c === 'q' && n && n.c === 'u') { r += 'kw'; k++; continue; }
      if (c === 'g' && n && n.c === 'n' && style === 'ro') { r += 'nj'; k++; continue; }
      if (c === 's' && n && n.c === 'c' && front(k + 2)) { r += (style === 'ro' ? 'sch' : 'sz'); k++; continue; }
      if (c === 'c' && n && n.c === 'c' && front(k + 2)) { r += (style === 'ro' ? 'ttsch' : 'kz'); k++; continue; }
      if (c === 'c') { r += front(k + 1) ? (style === 'ro' ? 'tsch' : 'z') : 'k'; continue; }
      if (c === 'g' && style === 'ro' && front(k + 1)) { r += (p && p.c === 'g') ? 'dsch' : 'dsch'; if (p && p.c === 'g') r = r.slice(0, -5) + 'ddsch'; continue; }
      if (c === 't' && n && n.c === 'i' && isV(L[k + 2]) && !(p && 'stx'.indexOf(p.c) >= 0)) { r += (style === 'ro' ? 'ts' : 'z'); continue; }
      if ((c === 'a' || c === 'o') && n && n.c === 'e' && !n.hi) { r += a(style === 'ro' ? 'e' : (c === 'a' ? 'ä' : 'ö'), x.acc || n.acc); k++; continue; }
      if (c === 'e' && k === 0 && n && n.c === 'u') { r += a('e', x.acc) + '·' + a('u', n.acc); k++; continue; }
      if ((c === 'i' || c === 'j') && ((k === 0 && isV(n)) || (isV(p) && isV(n)))) { r += 'j'; continue; }
      if (c === 'j') { r += 'j'; continue; }
      if (c === 'v') { r += 'w'; continue; }
      if (c === 'x') { r += (style === 'ro' ? 'ks' : 'x'); continue; }
      if (c === 'z') { r += (style === 'ro' ? 'ds' : 'z'); continue; }
      if (c === 'y') { r += a(style === 'ro' ? 'i' : 'ü', x.acc); continue; }
      r += a(c, x.acc);
    }
    r = r.normalize('NFC');
    if (cap) r = r.charAt(0).toUpperCase() + r.slice(1);
    out += r;
  }
  return out;
}
function plain(src) { return src.normalize('NFD').replace(/[́̈]/g, '').normalize('NFC'); }
// Gebetstexte. Latein mit Betonungszeichen (werden zur Anzeige entfernt, für die Aussprachehilfe genutzt).
var TX = {
  kreuz: {
    de: ['Im Namen des Vaters', 'und des Sohnes', 'und des Heiligen Geistes.', 'Amen.'],
    la: ['In nómine Pátris,', 'et Fílii,', 'et Spíritus Sáncti.', 'Ámen.']
  },
  credo: {
    de: ['Ich glaube an Gott, den Vater, den Allmächtigen,', 'den Schöpfer des Himmels und der Erde,', 'und an Jesus Christus, seinen eingeborenen Sohn, unsern Herrn,',
      'empfangen durch den Heiligen Geist,', 'geboren von der Jungfrau Maria,', 'gelitten unter Pontius Pilatus,', 'gekreuzigt, gestorben und begraben,',
      'hinabgestiegen in das Reich des Todes,', 'am dritten Tage auferstanden von den Toten,', 'aufgefahren in den Himmel;', 'er sitzt zur Rechten Gottes, des allmächtigen Vaters;',
      'von dort wird er kommen, zu richten die Lebenden und die Toten.', 'Ich glaube an den Heiligen Geist,', 'die heilige katholische Kirche,', 'Gemeinschaft der Heiligen,',
      'Vergebung der Sünden,', 'Auferstehung der Toten', 'und das ewige Leben.', 'Amen.'],
    la: ['Crédo in Déum Pátrem omnipoténtem,', 'Creatórem caéli et térrae.', 'Et in Iésum Chrístum, Fílium éius únicum,', 'Dóminum nóstrum,',
      'qui concéptus est de Spíritu Sáncto,', 'nátus ex María Vírgine,', 'pássus sub Póntio Piláto,', 'crucifíxus, mórtuus, et sepúltus,',
      'descéndit ad ínferos,', 'tértia díe resurréxit a mórtuis,', 'ascéndit ad caélos,', 'sédet ad déxteram Déi Pátris omnipoténtis,',
      'índe ventúrus est iudicáre vívos et mórtuos.', 'Crédo in Spíritum Sánctum,', 'sánctam Ecclésiam cathólicam,', 'sanctórum communiónem,',
      'remissiónem peccatórum,', 'cárnis resurrectiónem,', 'vítam aetérnam.', 'Ámen.']
  },
  pater: {
    de: ['Vater unser im Himmel,', 'geheiligt werde dein Name.', 'Dein Reich komme.', 'Dein Wille geschehe,', 'wie im Himmel so auf Erden.', 'Unser tägliches Brot gib uns heute.',
      'Und vergib uns unsere Schuld,', 'wie auch wir vergeben unsern Schuldigern.', 'Und führe uns nicht in Versuchung,', 'sondern erlöse uns von dem Bösen.', 'Amen.'],
    la: ['Páter Nóster,', 'qui es in caélis,', 'sanctificétur nómen túum.', 'Advéniat régnum túum.', 'Fíat volúntas túa, sícut in caélo, et in térra.',
      'Pánem nóstrum quotidiánum da nóbis hódie.', 'Et dimítte nóbis débita nóstra,', 'sícut et nos dimíttimus debitóribus nóstris.',
      'Et ne nos indúcas in tentatiónem: sed líbera nos a málo.', 'Ámen.']
  },
  aveA: {
    de: ['Gegrüßet seist du, Maria, voll der Gnade,', 'der Herr ist mit dir.', 'Du bist gebenedeit unter den Frauen,', 'und gebenedeit ist die Frucht deines Leibes,'],
    la: ['Áve María, grátia pléna,', 'Dóminus técum.', 'Benedícta tu in muliéribus,', 'et benedíctus frúctus véntris túi, Iésus.']
  },
  aveB: {
    de: ['Heilige Maria, Mutter Gottes,', 'bitte für uns Sünder', 'jetzt und in der Stunde unseres Todes.', 'Amen.'],
    la: ['Sáncta María, Máter Déi,', 'óra pro nóbis peccatóribus,', 'nunc, et in hóra mórtis nóstrae.', 'Ámen.']
  },
  gloria: {
    de: ['Ehre sei dem Vater', 'und dem Sohn', 'und dem Heiligen Geist,', 'wie im Anfang, so auch jetzt', 'und alle Zeit', 'und in Ewigkeit.', 'Amen.'],
    la: ['Glória Pátri,', 'et Fílio,', 'et Spirítui Sáncto.', 'Sícut érat in princípio,', 'et nunc,', 'et sémper,', 'et in saécula saeculórum.', 'Ámen.']
  },
  fatima: {
    de: ['O mein Jesus,', 'verzeih uns unsere Sünden,', 'bewahre uns vor dem Feuer der Hölle,', 'führe alle Seelen in den Himmel,', 'besonders jene,', 'die deiner Barmherzigkeit am meisten bedürfen.'],
    la: ['Dómine Jésu,', 'dimítte nóbis débita nóstra,', 'sálva nos ab ígne inferióri,', 'perdúc in caélum ómnes ánimas,', 'praesértim éas,',
      'quae misericórdiae túae máxime índigent.', 'Ámen.']
  },
  salve: {
    de: ['Sei gegrüßt, o Königin,', 'Mutter der Barmherzigkeit,', 'unser Leben, unsre Wonne und unsre Hoffnung, sei gegrüßt!', 'Zu dir rufen wir verbannte Kinder Evas;',
      'zu dir seufzen wir trauernd und weinend in diesem Tal der Tränen.', 'Wohlan denn, unsre Fürsprecherin,', 'wende deine barmherzigen Augen uns zu,',
      'und nach diesem Elend zeige uns Jesus,', 'die gebenedeite Frucht deines Leibes!', 'O gütige, o milde, o süße Jungfrau Maria.'],
    la: ['Sálve, Regína, máter misericórdiae,', 'víta, dulcédo, et spes nóstra, sálve.', 'Ad te clamámus, éxsules fílii Hévae.',
      'Ad te suspirámus, geméntes et fléntes in hac lacrimárum válle.', 'Éia, érgo, advocáta nóstra,', 'íllos túos misericórdes óculos ad nos convérte.',
      'Et Iésum, benedíctum frúctum véntris túi,', 'nóbis post hoc exsílium osténde.', 'O clémens, o pía, o dúlcis Vírgo María.']
  },
  michael: {
    de: ['Heiliger Erzengel Michael, verteidige uns im Kampfe!', 'Gegen die Bosheit und die Nachstellungen des Teufels sei unser Schutz.',
      '„Gebiete ihm, o Gott!“, so bitten wir flehentlich;', 'du aber, Fürst der himmlischen Heerscharen,', 'stoße den Satan und die anderen bösen Geister,',
      'die zum Verderben der Seelen die Welt durchziehen,', 'mit der Kraft Gottes in die Hölle.', 'Amen.'],
    la: ['Sáncte Míchaël Archángele,', 'defénde nos in proélio,', 'cóntra nequítiam et insídias diáboli ésto praesídium.',
      'Ímperet ílli Déus, súpplices deprecámur:', 'túque, prínceps milítiae caeléstis,', 'Sátanam aliósque spíritus malígnos,',
      'qui ad perditiónem animárum pervagántur in múndo,', 'divína virtúte, in inférnum detrúde.', 'Ámen.']
  }
};
var OPEN_INS = {
  de: ['Jesus, der in uns den Glauben vermehre.', 'Jesus, der in uns die Hoffnung stärke.', 'Jesus, der in uns die Liebe entzünde.'],
  la: ['qui adáugeat nóbis fídem.', 'qui corróboret nóbis spem.', 'qui perfíciat nóbis caritátem.']
};
var OPEN_VIRT = ['Glaube', 'Hoffnung', 'Liebe'];
var DEC_DE = {
  gaudiosa: ['den du, o Jungfrau, vom Heiligen Geist empfangen hast', 'den du, o Jungfrau, zu Elisabet getragen hast', 'den du, o Jungfrau, geboren hast',
    'den du, o Jungfrau, im Tempel aufgeopfert hast', 'den du, o Jungfrau, im Tempel wiedergefunden hast'],
  luminosa: ['der von Johannes getauft worden ist', 'der sich bei der Hochzeit in Kana offenbart hat', 'der uns das Reich Gottes verkündet hat',
    'der auf dem Berg verklärt worden ist', 'der uns die Eucharistie geschenkt hat'],
  dolorosa: ['der für uns Blut geschwitzt hat', 'der für uns gegeißelt worden ist', 'der für uns mit Dornen gekrönt worden ist',
    'der für uns das schwere Kreuz getragen hat', 'der für uns gekreuzigt worden ist'],
  gloriosa: ['der von den Toten auferstanden ist', 'der in den Himmel aufgefahren ist', 'der uns den Heiligen Geist gesandt hat',
    'der dich, o Jungfrau, in den Himmel aufgenommen hat', 'der dich, o Jungfrau, im Himmel gekrönt hat']
};
var NAME_DE = {
  gaudiosa: ['Verkündigung', 'Heimsuchung', 'Geburt Jesu', 'Darstellung im Tempel', 'Wiederfindung im Tempel'],
  luminosa: ['Taufe im Jordan', 'Hochzeit zu Kana', 'Verkündigung des Reiches Gottes', 'Verklärung', 'Einsetzung der Eucharistie'],
  dolorosa: ['Ölberg', 'Geißelung', 'Dornenkrönung', 'Kreuztragung', 'Kreuzigung'],
  gloriosa: ['Auferstehung', 'Himmelfahrt', 'Sendung des Heiligen Geistes', 'Aufnahme Mariens in den Himmel', 'Krönung Mariens']
};
var ADJ = { gaudiosa: ['freudenreiche', 'gaudiósum'], luminosa: ['lichtreiche', 'luminósum'], dolorosa: ['schmerzhafte', 'dolorósum'], gloriosa: ['glorreiche', 'gloriósum'] };
var ORD = { de: ['erste', 'zweite', 'dritte', 'vierte', 'fünfte'], la: ['Prímum', 'Secúndum', 'Tértium', 'Quártum', 'Quíntum'] };
var MYST_LA = {
  gaudiosa: ['Annuntiátio', 'Visitátio', 'Natívitas', 'Praesentátio', 'Invéntio in Témplo'],
  luminosa: ['Baptísma ápud Iordánem', 'Autorevelátio ápud Canénse Matrimónium', 'Régni Déi Proclamátio', 'Transfigurátio', 'Eucharístiae Institútio'],
  dolorosa: ['Cruciátus in Hórto', 'Flagellátio', 'Coronátio cum Spínis', 'Baiulátio Crúcis', 'Crucifíxio'],
  gloriosa: ['Resurréctio', 'Ascénsio', 'Descénsus Spíritus Sáncti', 'Assúmptio', 'Coronátio']
};
var REF = {
  gaudiosa: ['Lk 1,26-38', 'Lk 1,39-56', 'Lk 2,1-20', 'Lk 2,22-40', 'Lk 2,41-52'],
  luminosa: ['Mt 3,13-17', 'Joh 2,1-11', 'Mk 1,14-15', 'Mt 17,1-9', 'Mt 26,26-29'],
  dolorosa: ['Mt 26,36-46', 'Mk 15,6-15', 'Mt 27,27-31', 'Lk 23,26-32', 'Lk 23,33-49'],
  gloriosa: ['Lk 24,1-12', 'Apg 1,6-11', 'Apg 2,1-13', 'Lk 1,46-55 · 1 Kor 15,20-26', 'Offb 12,1-6']
};
var GRP = { gaudiosa: 'freud', luminosa: 'licht', dolorosa: 'schmerz', gloriosa: 'glor' };

// Baut die Schrittfolge des ganzen Rosenkranzes
function buildSteps(myst, mode) {
  var S = [];
  if (mode === 'betr') {
    for (var bd = 0; bd < 5; bd++) S.push({ part: 'dec', dec: bd, key: 'betr', de: 'Geheimnis', la: 'Mysterium', hint: '', beads: 10 });
    return S;
  }
  S.push({ part: 'open', key: 'kreuz', de: 'Kreuzzeichen', la: 'Signum Crucis', hint: 'Nimm das Kreuz in die Hand und bekreuzige dich.' });
  S.push({ part: 'open', key: 'credo', de: 'Glaubensbekenntnis', la: 'Credo', hint: 'Am Kreuz betest du das Glaubensbekenntnis.' });
  S.push({ part: 'open', key: 'pater', de: 'Vaterunser', la: 'Pater Noster', hint: 'An der ersten großen Perle.' });
  for (var o = 0; o < 3; o++) S.push({ part: 'open', key: 'ave', open: o, de: 'Ave Maria', la: 'Ave Maria', hint: 'An der ' + ['ersten', 'zweiten', 'dritten'][o] + ' der drei kleinen Perlen bittest du um ' + ['den Glauben', 'die Hoffnung', 'die Liebe'][o] + '.' });
  S.push({ part: 'open', key: 'gloria', de: 'Ehre sei dem Vater', la: 'Gloria Patri', hint: 'Vor der nächsten großen Perle.' });
  for (var d = 0; d < 5; d++) {
    S.push({ part: 'dec', dec: d, key: 'ansage', de: 'Geheimnis', la: 'Mysterium', hint: 'Bevor du betest: Lies die Bibelstelle oder betrachte das Bild in Ruhe. Beim Beten der Ave gehst du dann mit diesem Geheimnis im Herzen weiter.' });
    S.push({ part: 'dec', dec: d, key: 'pater', de: 'Vaterunser', la: 'Pater Noster', hint: 'An der großen Perle.' });
    S.push({ part: 'dec', dec: d, key: 'ave', de: 'Ave Maria', la: 'Ave Maria', hint: 'Zehnmal an den kleinen Perlen. Nach „Jesus“ fügst du das Geheimnis ein. Tippe nach jedem Ave auf den Zähler.', beads: 10 });
    S.push({ part: 'dec', dec: d, key: 'gloria', de: 'Ehre sei dem Vater', la: 'Gloria Patri', hint: 'Nach dem zehnten Ave.' });
    S.push({ part: 'dec', dec: d, key: 'fatima', de: 'Fatima-Gebet', la: 'Domine Iesu', hint: 'Das Gebet, um das Maria in Fatima gebeten hat.' });
  }
  S.push({ part: 'close', key: 'salve', de: 'Salve Regina', la: 'Salve Regina', hint: 'Zum Abschluss grüßt du Maria als Königin.' });
  S.push({ part: 'close', key: 'michael', de: 'Gebet zum hl. Michael', la: 'Sancte Michael', hint: 'Mit dem Gebet zum Erzengel Michael endet der Rosenkranz.' });
  return S;
}
var IMG = {
"freud-1-a":'img/freud-1-a.jpg',"freud-1-b":'img/freud-1-b.jpg',"freud-1-c":'img/freud-1-c.jpg',
"freud-2-a":'img/freud-2-a.jpg',"freud-2-b":'img/freud-2-b.jpg',"freud-2-c":'img/freud-2-c.jpg',
"freud-3-a":'img/freud-3-a.jpg',"freud-3-b":'img/freud-3-b.jpg',"freud-3-c":'img/freud-3-c.jpg',
"freud-4-a":'img/freud-4-a.jpg',"freud-4-b":'img/freud-4-b.jpg',"freud-4-c":'img/freud-4-c.jpg',
"freud-5-a":'img/freud-5-a.jpg',"freud-5-b":'img/freud-5-b.jpg',"freud-5-c":'img/freud-5-c.jpg',
"licht-1-a":'img/licht-1-a.jpg',"licht-1-b":'img/licht-1-b.jpg',"licht-1-c":'img/licht-1-c.jpg',
"licht-2-a":'img/licht-2-a.jpg',"licht-2-b":'img/licht-2-b.jpg',"licht-2-c":'img/licht-2-c.jpg',
"licht-3-a":'img/licht-3-a.jpg',"licht-3-b":'img/licht-3-b.jpg',"licht-3-c":'img/licht-3-c.jpg',
"licht-4-a":'img/licht-4-a.jpg',"licht-4-b":'img/licht-4-b.jpg',"licht-4-c":'img/licht-4-c.jpg',
"licht-5-a":'img/licht-5-a.jpg',"licht-5-b":'img/licht-5-b.jpg',"licht-5-c":'img/licht-5-c.jpg',
"schmerz-1-a":'img/schmerz-1-a.jpg',"schmerz-1-b":'img/schmerz-1-b.jpg',"schmerz-1-c":'img/schmerz-1-c.jpg',
"schmerz-2-a":'img/schmerz-2-a.jpg',"schmerz-2-b":'img/schmerz-2-b.jpg',"schmerz-2-c":'img/schmerz-2-c.jpg',
"schmerz-3-a":'img/schmerz-3-a.jpg',"schmerz-3-b":'img/schmerz-3-b.jpg',"schmerz-3-c":'img/schmerz-3-c.jpg',
"schmerz-4-a":'img/schmerz-4-a.jpg',"schmerz-4-b":'img/schmerz-4-b.jpg',"schmerz-4-c":'img/schmerz-4-c.jpg',
"schmerz-5-a":'img/schmerz-5-a.jpg',"schmerz-5-b":'img/schmerz-5-b.jpg',"schmerz-5-c":'img/schmerz-5-c.jpg',
"glor-1-a":'img/glor-1-a.jpg',"glor-1-b":'img/glor-1-b.jpg',"glor-1-c":'img/glor-1-c.jpg',
"glor-2-a":'img/glor-2-a.jpg',"glor-2-b":'img/glor-2-b.jpg',"glor-2-c":'img/glor-2-c.jpg',
"glor-3-a":'img/glor-3-a.jpg',"glor-3-b":'img/glor-3-b.jpg',"glor-3-c":'img/glor-3-c.jpg',
"glor-4-a":'img/glor-4-a.jpg',"glor-4-b":'img/glor-4-b.jpg',"glor-4-c":'img/glor-4-c.jpg',
"glor-5-a":'img/glor-5-a.jpg',"glor-5-b":'img/glor-5-b.jpg',"glor-5-c":'img/glor-5-c.jpg'
};
var CREDIT = {
"freud-1-a":["Fra Angelico","Verkündigung, Prado, Madrid"],"freud-1-b":["Leonardo da Vinci","Verkündigung, Uffizien, Florenz"],"freud-1-c":["Henry Ossawa Tanner","Die Verkündigung, Philadelphia Museum of Art"],
"freud-2-a":["Domenico Ghirlandaio","Heimsuchung, Louvre, Paris"],"freud-2-b":["Jacopo Pontormo","Heimsuchung, Carmignano"],"freud-2-c":["Rogier van der Weyden","Heimsuchung"],
"freud-3-a":["Sandro Botticelli","Mystische Geburt, National Gallery, London"],"freud-3-b":["Geertgen tot Sint Jans","Geburt Christi bei Nacht"],"freud-3-c":["Gerard van Honthorst","Anbetung der Hirten (1622)"],
"freud-4-a":["Andrea Mantegna","Darstellung im Tempel"],"freud-4-b":["Giovanni Bellini","Darstellung im Tempel, Querini Stampalia, Venedig"],"freud-4-c":["Stefan Lochner","Darbringung im Tempel (1447)"],
"freud-5-a":["Duccio di Buoninsegna","Jesus unter den Schriftgelehrten"],"freud-5-b":["Albrecht Dürer","Der zwölfjährige Jesus unter den Schriftgelehrten"],"freud-5-c":["William Holman Hunt","Die Auffindung des Erlösers im Tempel"],
"licht-1-a":["Piero della Francesca","Taufe Christi, National Gallery, London"],"licht-1-b":["Verrocchio und Leonardo","Taufe Christi, Uffizien, Florenz"],"licht-1-c":["Gerard David","Taufe Christi (Triptychon des Jan des Trompes)"],
"licht-2-a":["Paolo Veronese","Die Hochzeit zu Kana, Louvre, Paris"],"licht-2-b":["Giotto","Hochzeit zu Kana, Cappella degli Scrovegni, Padua"],"licht-2-c":["Gerard David","Die Hochzeit zu Kana"],
"licht-3-a":["Carl Heinrich Bloch","Die Bergpredigt"],"licht-3-b":["Fra Angelico","Die Bergpredigt, San Marco, Florenz"],"licht-3-c":["Claude Lorrain","Die Bergpredigt, Frick Collection, New York"],
"licht-4-a":["Raffael","Die Verklärung Christi"],"licht-4-b":["Giovanni Bellini","Verklärung Christi"],"licht-4-c":["Fra Angelico","Verklärung, San Marco, Florenz"],
"licht-5-a":["Leonardo da Vinci","Das Abendmahl, Santa Maria delle Grazie, Mailand"],"licht-5-b":["Juan de Juanes","Das letzte Abendmahl"],"licht-5-c":["Dieric Bouts","Abendmahlsaltar, Löwen"],
"schmerz-1-a":["Andrea Mantegna","Christus am Ölberg, National Gallery, London"],"schmerz-1-b":["Giovanni Bellini","Christus am Ölberg, National Gallery, London"],"schmerz-1-c":["El Greco","Christus am Ölberg"],
"schmerz-2-a":["Piero della Francesca","Geißelung Christi"],"schmerz-2-b":["Caravaggio","Geißelung Christi"],"schmerz-2-c":["Peter Paul Rubens","Geißelung Christi, Sint-Pauluskerk, Antwerpen"],
"schmerz-3-a":["Caravaggio","Dornenkrönung"],"schmerz-3-b":["Tizian","Dornenkrönung, Louvre, Paris"],"schmerz-3-c":["Hieronymus Bosch","Die Verspottung Christi"],
"schmerz-4-a":["El Greco","Christus trägt das Kreuz"],"schmerz-4-b":["Raffael","Lo Spasimo"],"schmerz-4-c":["Tizian","Christus trägt das Kreuz, Prado, Madrid"],
"schmerz-5-a":["Andrea Mantegna","Kreuzigung, Louvre, Paris"],"schmerz-5-b":["Diego Velázquez","Der gekreuzigte Christus"],"schmerz-5-c":["Rogier van der Weyden","Kreuzigungsdiptychon"],
"glor-1-a":["Piero della Francesca","Auferstehung"],"glor-1-b":["Matthias Grünewald","Auferstehung (Isenheimer Altar)"],"glor-1-c":["Fra Angelico","Noli me tangere, San Marco, Florenz"],
"glor-2-a":["Giotto","Himmelfahrt Christi, Cappella degli Scrovegni, Padua"],"glor-2-b":["Rembrandt","Himmelfahrt Christi, Alte Pinakothek, München"],"glor-2-c":["Andrea Mantegna","Himmelfahrt Christi"],
"glor-3-a":["Giotto","Pfingsten, Cappella degli Scrovegni, Padua"],"glor-3-b":["El Greco","Pfingsten, Prado, Madrid"],"glor-3-c":["Tizian","Pfingsten, Santa Maria della Salute, Venedig"],
"glor-4-a":["Tizian","Assunta"],"glor-4-b":["Peter Paul Rubens","Mariä Himmelfahrt"],"glor-4-c":["El Greco","Mariä Himmelfahrt, Art Institute of Chicago"],
"glor-5-a":["Fra Angelico","Krönung Mariens, Louvre, Paris"],"glor-5-b":["Diego Velázquez","Krönung Mariens, Prado, Madrid"],"glor-5-c":["Enguerrand Quarton","Marienkrönung (1454)"]
};

class Component extends DCLogic {
  renderVals() {
    var S = this.state || {};
    var P = this.props;
    var self = this;
    // Sprache: DE, LA oder LA+ (Latein mit Aussprachehilfe); Startwert von der Startseite
    var initSel = (P.sprache === 'la') ? ((P.aussprache && P.aussprache !== 'aus') ? 'la+' : 'la') : 'de';
    var langSel = S.lang || initSel;
    var lang = langSel === 'de' ? 'de' : 'la';
    var pronStyleP = (P.aussprache && P.aussprache !== 'aus') ? P.aussprache : (P.ausspracheStil ?? 'ro');
    var mode = P.modus ?? 'anf';
    var pronMode = langSel === 'la+' ? pronStyleP : 'aus';
    // Erscheinungsbild wie auf der Startseite (wird von dort übergeben)
    var themePref = P.erscheinungsbild ?? 'hell';
    var sysDark = false;
    try { sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) {}
    var dark = themePref === 'dunkel' || (themePref === 'system' && sysDark);
    var litOn = P.liturgischeFarbe === true || P.liturgischeFarbe === 'true';
    var LIT = { jahreskreis: 'gruen', weihnachtszeit: 'weiss', osterzeit: 'weiss' };
    var ACCENTS = { rot: ['#9E2A20', '#9E2A20', '#E8907F', '#A8352A'], gruen: ['#2E6B3C', '#2E6B3C', '#86C495', '#2F6D3D'], weiss: ['#85631A', '#85631A', '#D9B866', '#7A5B16'] };
    var AC = ACCENTS[litOn ? (LIT[P.season ?? 'jahreskreis'] || 'gruen') : 'rot'];
    var c = dark
      ? { paper: '#171512', card: '#221F1B', ink: '#EDE7DC', muted: '#A9A194', rule: '#3B362F', rule2: '#2E2A25', accentText: AC[2], accentFill: AC[3] }
      : { paper: '#F8F6F1', card: '#FFFFFF', ink: '#1D1B18', muted: '#5E5850', rule: '#DDD6CA', rule2: '#EAE4DA', accentText: AC[0], accentFill: AC[1] };
    var hasClose = typeof P.onClose === 'function';
    // Beim Blättern den Textbereich wieder nach oben setzen
    var toTop = function () { try { var el = document.querySelector('[data-gebet-main]'); if (el) el.scrollTop = 0; } catch (e) {} };

    var now = new Date();
    var todayKey = ['gloriosa', 'gaudiosa', 'dolorosa', 'gloriosa', 'luminosa', 'dolorosa', 'gaudiosa'][now.getDay()];
    var m = (P.geheimnis && P.geheimnis !== 'heute') ? P.geheimnis : todayKey;
    var doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);

    var steps = buildSteps(m, mode);
    var betr = mode === 'betr';
    var N = steps.length;
    var startIdx = Math.min(Math.max(+(P.startSchritt ?? 0), 0), N - 1);
    var i = S.step !== undefined ? S.step : startIdx;
    var s = steps[i];
    var la = lang === 'la';

    // Zähler für die Ave Maria eines Schritts
    var counts = S.counts || {};
    var cnt = counts[i] !== undefined ? counts[i] : ((i === startIdx && P.startZahl) ? Math.min(+P.startZahl, s.beads || 0) : 0);
    var setCount = function (v) { var u = {}; for (var k in counts) u[k] = counts[k]; u[i] = v; self.setState({ counts: u }); };

    // Bildauswahl je Gesätz (Standard wechselt täglich)
    var vars = S.vars || {};
    var vIdx = (s.part === 'dec' && vars[s.dec] !== undefined) ? vars[s.dec] : doy % 3;
    var variant = ['a', 'b', 'c'][vIdx];

    var mk = function (raw, em) {
      var showP = la && pronMode !== 'aus';
      return { text: la ? plain(raw) : raw, hasPron: showP, pron: showP ? pron(raw, pronMode) : '', color: em ? c.accentText : c.ink, weight: em ? '500' : '400' };
    };
    var lines = [];
    var mystLine = '', refLine = '';
    if (s.part === 'dec') {
      mystLine = la ? plain(MYST_LA[m][s.dec]) : 'Jesus, ' + DEC_DE[m][s.dec];
      refLine = NAME_DE[m][s.dec] + ' · ' + REF[m][s.dec];
    }
    if (s.key === 'ansage') {
      lines = la
        ? [mk(ORD.la[s.dec] + ' mystérium ' + ADJ[m][1] + ':', false), mk(MYST_LA[m][s.dec], true)]
        : [mk('Das ' + ORD.de[s.dec] + ' ' + ADJ[m][0] + ' Geheimnis:', false), mk('Jesus, ' + DEC_DE[m][s.dec] + '.', true)];
    } else if (s.key === 'ave') {
      var A = TX.aveA[lang].map(function (l) { return mk(l, false); });
      var B = TX.aveB[lang].map(function (l) { return mk(l, false); });
      if (s.part === 'open') {
        var oi = s.open;
        if (la) { A[3] = mk('et benedíctus frúctus véntris túi, Iésus,', false); A.push(mk(OPEN_INS.la[oi], true)); }
        else A.push(mk(OPEN_INS.de[oi], true));
      } else if (!la) {
        A.push(mk('Jesus, ' + DEC_DE[m][s.dec] + '.', true));
      }
      lines = A.concat(B);
    } else if (TX[s.key]) {
      lines = TX[s.key][lang].map(function (l) { return mk(l, false); });
    }

    // Lange Gebete (Credo, Salve Regina, Michaelsgebet) als Fließtext, damit man sie auf einen Blick lesen kann.
    // Mit Aussprachehilfe bleiben sie zeilenweise, weil die Umschrift unter jeder Zeile steht.
    var totalChars = lines.reduce(function (n, l) { return n + l.text.length; }, 0);
    var longText = totalChars > 320;
    var flow = longText && !(la && pronMode !== 'aus');
    var beginner = mode === 'anf';
    var showText = beginner || !S.hideText;
    var section = s.part === 'open' ? 'Eröffnung' : (s.part === 'close' ? 'Abschluss' : (s.dec + 1) + '. Gesätz · ' + NAME_DE[m][s.dec]);
    var setTitle = { gaudiosa: 'Die freudenreichen Geheimnisse', luminosa: 'Die lichtreichen Geheimnisse', dolorosa: 'Die schmerzhaften Geheimnisse', gloriosa: 'Die glorreichen Geheimnisse' }[m];
    var key = s.part === 'dec' ? GRP[m] + '-' + (s.dec + 1) + '-' + variant : '';
    var kicker = la ? s.la : s.de;
    if (betr) kicker = (s.dec + 1) + '. ' + kicker;
    if (s.key === 'ave' && s.part === 'open') kicker += ' · ' + OPEN_VIRT[s.open];

    var beadsArr = [];
    if (s.beads) for (var b = 0; b < s.beads; b++) beadsArr.push({ fill: b < cnt ? c.accentText : 'transparent' });
    var full = !!s.beads && cnt >= s.beads;

    return {
      c: c,
      section: section,
      langLabel: langSel === 'la+' ? 'LA+' : (la ? 'LA' : 'DE'),
      toggleLang: function () { self.setState({ lang: { de: 'la', la: 'la+', 'la+': 'de' }[langSel] }); },
      progress: Math.round((i + 1) / N * 100) + '%',
      hasImage: !!key, noImage: !key,
      img: key ? { src: IMG[key], alt: CREDIT[key][0] + ', ' + CREDIT[key][1], count: 'Bild ' + (vIdx + 1) + ' von 3' } : { src: '', alt: '', count: '' },
      nextImage: function () { var u = {}; for (var k in vars) u[k] = vars[k]; u[s.dec] = (vIdx + 1) % 3; self.setState({ vars: u }); },
      hasRef: s.key === 'ansage',
      refName: s.part === 'dec' ? NAME_DE[m][s.dec] : '',
      refText: s.part === 'dec' ? REF[m][s.dec] : '',
      isCounter: !!s.beads,
      counterLabel: full ? 'Alle zehn Ave gebetet' : 'Ave gebetet',
      counterBg: full ? c.rule2 : c.card,
      inc: function () { if (cnt < s.beads) setCount(cnt + 1); },
      dec: function () { if (cnt > 0) setCount(cnt - 1); },
      countText: cnt + ' von ' + (s.beads || 0),
      partLabel: s.part === 'open' ? 'Eröffnung' : 'Abschluss',
      setTitle: setTitle,
      kicker: kicker,
      hasMystLine: s.part === 'dec' && s.key !== 'ansage',
      mystLine: mystLine, refLine: refLine,
      showLines: !betr && (showText || s.key === 'ansage'),
      showFlow: flow && !betr && (showText || s.key === 'ansage'),
      lineSize: longText ? '19px' : '22px',
      showLineList: !flow && !betr && (showText || s.key === 'ansage'),
      imgHeight: betr ? '400px' : '230px',
      mystSize: betr ? '26px' : '20px',
      lines: lines,
      lineGap: (la && pronMode !== 'aus') ? '8px' : '0px',
      canToggleText: !beginner && !betr && s.key !== 'ansage',
      toggleText: function () { self.setState({ hideText: !S.hideText }); },
      textChecked: S.hideText ? 'false' : 'true',
      textTrack: S.hideText ? (dark ? '#5A544B' : '#B8AFA2') : c.accentFill,
      textJustify: S.hideText ? 'flex-start' : 'flex-end',
      hasHint: beginner && !!s.hint,
      hint: s.hint,
      beads: beadsArr,
      beadLabel: s.beads ? 'Ave gebetet, ' + cnt + ' von ' + s.beads + ' gezählt' : '',
      prev: function () { toTop(); self.setState({ step: Math.max(0, i - 1) }); },
      prevOpacity: i === 0 ? '0.4' : '1',
      next: function () { toTop(); self.setState({ step: Math.min(N - 1, i + 1) }); },
      nextLabel: betr ? 'Nächstes Geheimnis' : ((s.key === 'ave' && s.beads && N > i + 1) ? 'Weiter zu ' + (la ? steps[i + 1].la : steps[i + 1].de) : 'Weiter'),
      rootW: P.vollbild ? 'min(100vw, 480px)' : '390px',
      rootH: P.vollbild ? '100%' : '844px',
      notLast: i < N - 1, isLast: i === N - 1,
      hasClose: hasClose, noClose: !hasClose,
      close: function () { if (hasClose) P.onClose(); },
      lastClose: i === N - 1 && hasClose, lastLink: i === N - 1 && !hasClose
    };
  }
}

return Component;
})(), ["hideText"]);
DC.register('Main', 'tpl-Main', (function () {
function autoSeason(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var y = d.getFullYear();
  var e = new Date(y, 0, 6); var bap = new Date(y, 0, 6 + (7 - e.getDay()));
  if (d >= new Date(y, 11, 25) || d <= bap) return 'weihnachtszeit';
  var easter = easterDate(y);
  var pent = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 49);
  if (d >= easter && d <= pent) return 'osterzeit';
  return 'jahreskreis';
}

var SAINTS = {"reg":{"01-01":[["H","Hochfest der Gottesmutter Maria"]],"01-02":[["G","Hl. Basilius der Große und hl. Gregor von Nazianz"]],"01-03":[["g","Heiligster Name Jesu"]],"01-05":[["g","Hl. Johannes Nepomuk Neumann"]],"01-06":[["H","Erscheinung des Herrn"]],"01-07":[["g","Hl. Valentin von Rätien"],["g","Hl. Raimund von Peñafort"]],"01-08":[["g","Hl. Severin von Noricum"]],"01-13":[["g","Hl. Hilarius von Poitiers"]],"01-17":[["G","Hl. Antonius der Große"]],"01-20":[["g","Hl. Fabian"],["g","Hl. Sebastian"]],"01-21":[["G","Hl. Agnes"],["g","Hl. Meinrad"]],"01-22":[["g","Hl. Vinzenz von Saragossa"]],"01-23":[["g","Sel. Heinrich Seuse"]],"01-24":[["G","Hl. Franz von Sales"]],"01-25":[["F","Bekehrung des hl. Apostels Paulus"]],"01-26":[["G","Hl. Timotheus und hl. Titus"]],"01-27":[["g","Hl. Angela Merici"]],"01-28":[["G","Hl. Thomas von Aquin"]],"01-31":[["G","Hl. Johannes Bosco"]],"02-02":[["F","Darstellung des Herrn"]],"02-03":[["g","Hl. Blasius"],["g","Hl. Ansgar"]],"02-04":[["g","Hl. Rabanus Maurus"]],"02-05":[["G","Hl. Agatha"]],"02-06":[["G","Hl. Paul Miki und Gefährten"]],"02-08":[["g","Hl. Hieronymus Ämiliani"],["g","Hl. Josefine Bakhita"]],"02-10":[["G","Hl. Scholastika"]],"02-11":[["g","Gedenktag Unserer Lieben Frau in Lourdes"]],"02-14":[["F","Hl. Cyrill und hl. Methodius"]],"02-17":[["g","Hll. Sieben Gründer des Servitenordens"]],"02-21":[["g","Hl. Petrus Damiani"]],"02-22":[["F","Kathedra Petri"]],"02-23":[["G","Hl. Polykarp"]],"02-24":[["F","Hl. Matthias, Apostel"]],"02-25":[["g","Hl. Walburga"]],"02-27":[["g","Hl. Gregor von Narek"]],"03-04":[["g","Hl. Kasimir"]],"03-06":[["g","Hl. Fridolin von Säckingen"]],"03-07":[["G","Hl. Perpetua und hl. Felizitas"]],"03-08":[["g","Hl. Johannes von Gott"]],"03-09":[["g","Hl. Bruno von Querfurt"],["g","Hl. Franziska von Rom"]],"03-14":[["g","Hl. Mathilde"]],"03-15":[["g","Hl. Klemens Maria Hofbauer"]],"03-17":[["g","Hl. Gertrud von Nivelles"],["g","Hl. Patrick"]],"03-18":[["g","Hl. Cyrill von Jerusalem"]],"03-19":[["H","Hl. Josef, Bräutigam der Gottesmutter"]],"03-23":[["g","Hl. Turibio von Mongrovejo"]],"03-25":[["H","Verkündigung des Herrn"]],"03-26":[["g","Hl. Liudger"]],"04-02":[["g","Hl. Franz von Paola"]],"04-04":[["g","Hl. Isidor von Sevilla"]],"04-05":[["g","Hl. Vinzenz Ferrer"]],"04-07":[["G","Hl. Johannes Baptist de La Salle"]],"04-11":[["G","Hl. Stanislaus"]],"04-13":[["g","Hl. Martin I."]],"04-19":[["g","Hl. Leo IX."],["g","Sel. Marcel Callo"]],"04-21":[["g","Hl. Konrad von Parzham"],["g","Hl. Anselm von Canterbury"]],"04-23":[["g","Hl. Georg"],["g","Hl. Adalbert"]],"04-24":[["g","Hl. Fidelis von Sigmaringen"]],"04-25":[["F","Hl. Markus, Evangelist"]],"04-27":[["g","Hl. Petrus Canisius"]],"04-28":[["g","Hl. Peter Chanel"],["g","Hl. Ludwig Maria Grignion de Montfort"]],"04-29":[["F","Hl. Katharina von Siena"]],"04-30":[["g","Hl. Pius V."]],"05-01":[["g","Hl. Josef der Arbeiter"]],"05-02":[["G","Hl. Athanasius"]],"05-03":[["F","Hl. Philippus und hl. Jakobus, Apostel"]],"05-04":[["g","Hl. Florian und Gefährten"]],"05-05":[["g","Hl. Godehard"]],"05-10":[["g","Hl. Johannes von Avila"]],"05-12":[["g","Hl. Nereus und hl. Achilleus"],["g","Hl. Pankratius"]],"05-13":[["g","Gedenktag Unserer Lieben Frau in Fatima"]],"05-16":[["g","Hl. Johannes Nepomuk"]],"05-18":[["g","Hl. Johannes I."]],"05-20":[["g","Hl. Bernhardin von Siena"]],"05-21":[["g","Hl. Hermann Josef"],["g","Hl. Christophorus Magallanes und Gefährten"]],"05-22":[["g","Hl. Rita von Cascia"]],"05-25":[["g","Hl. Beda der Ehrwürdige"],["g","Hl. Gregor VII."],["g","Hl. Maria Magdalena von Pazzi"]],"05-26":[["G","Hl. Philipp Neri"]],"05-27":[["g","Hl. Augustinus von Canterbury"]],"05-29":[["g","Hl. Paul VI."]],"06-01":[["G","Hl. Justin"]],"06-02":[["g","Hl. Marcellinus und hl. Petrus"]],"06-03":[["G","Hl. Karl Lwanga und Gefährten"]],"06-05":[["G","Hl. Bonifatius"]],"06-06":[["g","Hl. Norbert von Xanten"]],"06-09":[["g","Hl. Ephräm der Syrer"]],"06-11":[["G","Hl. Barnabas, Apostel"]],"06-13":[["G","Hl. Antonius von Padua"]],"06-15":[["g","Hl. Vitus"]],"06-16":[["g","Hl. Benno von Meißen"]],"06-19":[["g","Hl. Romuald"]],"06-21":[["G","Hl. Aloisius Gonzaga"]],"06-22":[["g","Hl. Paulinus von Nola"],["g","Hl. John Fisher und hl. Thomas Morus"]],"06-24":[["H","Geburt des hl. Johannes des Täufers"]],"06-27":[["g","Hl. Hemma von Gurk"],["g","Hl. Cyrill von Alexandrien"]],"06-28":[["G","Hl. Irenäus von Lyon"]],"06-29":[["H","Hl. Petrus und hl. Paulus, Apostel"]],"06-30":[["g","Hl. Otto von Bamberg"],["g","Die ersten heiligen Märtyrer der Stadt Rom"]],"07-02":[["F","Mariä Heimsuchung"]],"07-03":[["F","Hl. Thomas, Apostel"]],"07-04":[["g","Hl. Ulrich von Augsburg"],["g","Hl. Elisabeth von Portugal"]],"07-05":[["g","Hl. Antonius Maria Zaccaria"]],"07-06":[["g","Hl. Maria Goretti"]],"07-07":[["g","Hl. Willibald"]],"07-08":[["g","Hl. Kilian und Gefährten"]],"07-09":[["g","Hl. Augustinus Zhao Rong und Gefährten"]],"07-10":[["g","Hl. Knud, hl. Erich und hl. Olaf"]],"07-11":[["F","Hl. Benedikt von Nursia"]],"07-13":[["g","Hl. Heinrich und hl. Kunigunde"]],"07-14":[["g","Hl. Kamillus von Lellis"]],"07-15":[["G","Hl. Bonaventura"]],"07-16":[["g","Gedenktag Unserer Lieben Frau auf dem Berge Karmel"]],"07-20":[["g","Hl. Margareta von Antiochien"],["g","Hl. Apollinaris"]],"07-21":[["g","Hl. Laurentius von Brindisi"]],"07-22":[["F","Hl. Maria Magdalena"]],"07-23":[["F","Hl. Birgitta von Schweden"]],"07-24":[["g","Hl. Christophorus"],["g","Hl. Scharbel Machluf"]],"07-25":[["F","Hl. Jakobus, Apostel"]],"07-26":[["G","Hl. Joachim und hl. Anna"]],"07-29":[["G","Hl. Marta, hl. Maria und hl. Lazarus"]],"07-30":[["g","Hl. Petrus Chrysologus"]],"07-31":[["G","Hl. Ignatius von Loyola"]],"08-01":[["G","Hl. Alfons Maria von Liguori"]],"08-02":[["g","Hl. Eusebius von Vercelli"],["g","Hl. Petrus Julianus Eymard"]],"08-04":[["G","Hl. Johannes Maria Vianney"]],"08-05":[["g","Weihetag der Basilika Santa Maria Maggiore"]],"08-06":[["F","Verklärung des Herrn"]],"08-07":[["g","Hl. Xystus II. und Gefährten"],["g","Hl. Kajetan"]],"08-08":[["G","Hl. Dominikus"]],"08-09":[["F","Hl. Teresia Benedicta vom Kreuz (Edith Stein)"]],"08-10":[["F","Hl. Laurentius"]],"08-11":[["G","Hl. Klara von Assisi"]],"08-12":[["g","Hl. Johanna Franziska von Chantal"]],"08-13":[["g","Hl. Pontianus und hl. Hippolyt"]],"08-14":[["G","Hl. Maximilian Maria Kolbe"]],"08-15":[["H","Mariä Aufnahme in den Himmel"]],"08-16":[["g","Hl. Stephan von Ungarn"]],"08-19":[["g","Hl. Johannes Eudes"]],"08-20":[["G","Hl. Bernhard von Clairvaux"]],"08-21":[["G","Hl. Pius X."]],"08-22":[["G","Maria Königin"]],"08-23":[["g","Hl. Rosa von Lima"]],"08-24":[["F","Hl. Bartholomäus, Apostel"]],"08-25":[["g","Hl. Ludwig IX."],["g","Hl. Josef von Calasanz"]],"08-27":[["G","Hl. Monika"]],"08-28":[["G","Hl. Augustinus"]],"08-29":[["G","Enthauptung Johannes des Täufers"]],"08-31":[["g","Hl. Paulinus von Trier"]],"09-03":[["G","Hl. Gregor der Große"]],"09-05":[["g","Hl. Teresa von Kalkutta"]],"09-08":[["F","Mariä Geburt"]],"09-09":[["g","Hl. Petrus Claver"]],"09-12":[["g","Mariä Namen"]],"09-13":[["G","Hl. Johannes Chrysostomus"]],"09-14":[["F","Kreuzerhöhung"]],"09-15":[["G","Gedächtnis der Schmerzen Mariens"]],"09-16":[["G","Hl. Kornelius und hl. Cyprian"]],"09-17":[["g","Hl. Robert Bellarmin"],["g","Hl. Hildegard von Bingen"]],"09-18":[["g","Hl. Lambert von Maastricht"]],"09-19":[["g","Hl. Januarius"]],"09-20":[["G","Hl. Andreas Kim Taegon, hl. Paul Chong Hasang und Gefährten"]],"09-21":[["F","Hl. Matthäus, Apostel und Evangelist"]],"09-22":[["g","Hl. Mauritius und Gefährten"]],"09-23":[["G","Hl. Pio von Pietrelcina"]],"09-24":[["g","Hl. Rupert und hl. Virgil"]],"09-25":[["g","Hl. Niklaus von Flüe"]],"09-26":[["g","Hl. Kosmas und hl. Damian"]],"09-27":[["G","Hl. Vinzenz von Paul"]],"09-28":[["g","Hl. Lioba"],["g","Hl. Wenzel"],["g","Hl. Laurentius Ruiz und Gefährten"]],"09-29":[["F","Hl. Michael, hl. Gabriel und hl. Rafael, Erzengel"]],"09-30":[["G","Hl. Hieronymus"]],"10-01":[["G","Hl. Theresia vom Kinde Jesus"]],"10-02":[["G","Heilige Schutzengel"]],"10-04":[["G","Hl. Franz von Assisi"]],"10-05":[["g","Hl. Faustyna Kowalska"]],"10-06":[["g","Hl. Bruno"]],"10-07":[["G","Unsere Liebe Frau vom Rosenkranz"]],"10-09":[["g","Hl. Dionysius und Gefährten"],["g","Hl. Johannes Leonardi"],["g","Hl. John Henry Newman"]],"10-11":[["g","Hl. Johannes XXIII."]],"10-14":[["g","Hl. Kallistus I."]],"10-15":[["G","Hl. Teresa von Ávila"]],"10-16":[["g","Hl. Hedwig von Andechs"],["g","Hl. Margareta Maria Alacoque"],["g","Hl. Gallus"]],"10-17":[["G","Hl. Ignatius von Antiochien"]],"10-18":[["F","Hl. Lukas, Evangelist"]],"10-19":[["g","Hl. Johannes de Brébeuf, hl. Isaak Jogues und Gefährten"],["g","Hl. Paul vom Kreuz"]],"10-20":[["g","Hl. Wendelin"]],"10-21":[["g","Hl. Ursula und Gefährtinnen"]],"10-22":[["g","Hl. Johannes Paul II."]],"10-23":[["g","Hl. Johannes von Capestrano"]],"10-24":[["g","Hl. Antonius Maria Claret"]],"10-28":[["F","Hl. Simon und hl. Judas, Apostel"]],"10-31":[["g","Hl. Wolfgang von Regensburg"]],"11-01":[["H","Allerheiligen"]],"11-02":[["H","Allerseelen"]],"11-03":[["g","Hl. Martin von Porres"],["g","Hl. Hubert"],["g","Hl. Pirmin"],["g","Sel. Rupert Mayer"]],"11-04":[["G","Hl. Karl Borromäus"]],"11-06":[["g","Hl. Leonhard"]],"11-07":[["g","Hl. Willibrord"]],"11-09":[["F","Weihetag der Lateranbasilika"]],"11-10":[["G","Hl. Leo der Große"]],"11-11":[["G","Hl. Martin von Tours"]],"11-12":[["G","Hl. Josaphat"]],"11-15":[["g","Hl. Albert der Große"],["g","Hl. Leopold III."]],"11-16":[["g","Hl. Margareta von Schottland"]],"11-17":[["g","Hl. Gertrud von Helfta"]],"11-18":[["g","Weihetag der Basiliken St. Peter und St. Paul"]],"11-19":[["G","Hl. Elisabeth von Thüringen"]],"11-20":[["g","Hl. Korbinian"]],"11-21":[["G","Gedenktag Unserer Lieben Frau in Jerusalem"]],"11-22":[["G","Hl. Cäcilia"]],"11-23":[["g","Hl. Klemens I."],["g","Hl. Kolumban"]],"11-24":[["G","Hl. Andreas Dung-Lac und Gefährten"]],"11-25":[["g","Hl. Katharina von Alexandrien"]],"11-26":[["g","Hl. Konrad und hl. Gebhard von Konstanz"]],"11-30":[["F","Hl. Andreas, Apostel"]],"12-02":[["g","Hl. Luzius von Chur"]],"12-03":[["G","Hl. Franz Xaver"]],"12-04":[["g","Hl. Barbara"],["g","Hl. Johannes von Damaskus"],["g","Sel. Adolph Kolping"]],"12-05":[["g","Hl. Anno"]],"12-06":[["g","Hl. Nikolaus"]],"12-07":[["G","Hl. Ambrosius"]],"12-08":[["H","Hochfest der ohne Erbsünde empfangenen Jungfrau und Gottesmutter Maria"]],"12-09":[["g","Hl. Juan Diego Cuauhtlatoatzin"]],"12-10":[["g","Gedenktag Unserer Lieben Frau von Loreto"]],"12-11":[["g","Hl. Damasus I."]],"12-12":[["g","Unsere Liebe Frau von Guadalupe"]],"12-13":[["G","Hl. Luzia"],["g","Hl. Odilia"]],"12-14":[["G","Hl. Johannes vom Kreuz"]],"12-23":[["g","Hl. Johannes von Krakau"]],"12-25":[["H","Geburt des Herrn"]],"12-26":[["F","Hl. Stephanus"]],"12-27":[["F","Hl. Johannes, Apostel und Evangelist"]],"12-28":[["F","Unschuldige Kinder"]],"12-29":[["g","Hl. Thomas Becket"]],"12-31":[["g","Hl. Silvester I."]]},"c62":{"01-01":[["I","Oktavtag von Weihnachten"]],"01-05":[["C","Hl. Telesphorus"]],"01-06":[["I","Erscheinung des Herrn"]],"01-11":[["C","Hl. Hyginus"]],"01-13":[["II","Gedächtnis der Taufe des Herrn"]],"01-14":[["III","Hl. Hilarius"],["C","Hl. Felix von Nola"]],"01-15":[["III","Hl. Paulus der Einsiedler"],["C","Hl. Maurus"]],"01-16":[["III","Hl. Marcellus I."]],"01-17":[["III","Hl. Antonius der Große"]],"01-18":[["C","Hl. Priska"]],"01-19":[["C","Hll. Marius, Martha, Audifax und Abachum"],["C","Hl. Knud"]],"01-20":[["III","Hl. Fabian und hl. Sebastian"]],"01-21":[["III","Hl. Agnes"]],"01-22":[["III","Hl. Vinzenz und hl. Anastasius"]],"01-23":[["III","Hl. Raimund von Peñafort"],["C","Hl. Emerentiana"]],"01-24":[["III","Hl. Timotheus"]],"01-25":[["III","Bekehrung des hl. Paulus"],["C","Hl. Petrus"]],"01-26":[["III","Hl. Polykarp"]],"01-27":[["III","Hl. Johannes Chrysostomus"]],"01-28":[["III","Hl. Petrus Nolascus"],["C","Hl. Agnes"]],"01-29":[["III","Hl. Franz von Sales"]],"01-30":[["III","Hl. Martina"]],"01-31":[["III","Hl. Johannes Bosco"]],"02-01":[["III","Hl. Ignatius von Antiochien"]],"02-02":[["II","Mariä Lichtmess"]],"02-03":[["C","Hl. Blasius"]],"02-04":[["III","Hl. Andreas Corsini"]],"02-05":[["III","Hl. Agatha"]],"02-06":[["III","Hl. Titus"],["C","Hl. Dorothea"]],"02-07":[["III","Hl. Romuald"]],"02-08":[["III","Hl. Johannes von Matha"]],"02-09":[["III","Hl. Cyrill von Alexandrien"],["C","Hl. Apollonia"]],"02-10":[["III","Hl. Scholastika"]],"02-11":[["III","Erscheinung der Unbefleckten Jungfrau in Lourdes"]],"02-12":[["III","Hll. Sieben Gründer des Servitenordens"]],"02-14":[["C","Hl. Valentin"]],"02-15":[["C","Hl. Faustinus und hl. Jovita"]],"02-18":[["C","Hl. Simeon"]],"02-22":[["II","Kathedra Petri"],["C","Hl. Paulus"]],"02-23":[["III","Hl. Petrus Damiani"]],"02-24":[["II","Hl. Matthias, Apostel"]],"02-27":[["III","Hl. Gabriel von der schmerzhaften Muttergottes"]],"03-04":[["III","Hl. Kasimir"],["C","Hl. Lucius I."]],"03-06":[["III","Hl. Perpetua und hl. Felizitas"]],"03-07":[["III","Hl. Thomas von Aquin"]],"03-08":[["III","Hl. Johannes von Gott"]],"03-09":[["III","Hl. Franziska von Rom"]],"03-10":[["III","Hll. Vierzig Märtyrer"]],"03-12":[["III","Hl. Gregor der Große"]],"03-17":[["III","Hl. Patrick"]],"03-18":[["III","Hl. Cyrill von Jerusalem"]],"03-19":[["I","Hl. Josef, Bräutigam der Gottesmutter"]],"03-21":[["III","Hl. Benedikt"]],"03-24":[["III","Hl. Erzengel Gabriel"]],"03-25":[["I","Mariä Verkündigung"]],"03-27":[["III","Hl. Johannes von Damaskus"]],"03-28":[["III","Hl. Johannes von Capestrano"]],"04-02":[["III","Hl. Franz von Paola"]],"04-04":[["III","Hl. Isidor"]],"04-05":[["III","Hl. Vinzenz Ferrer"]],"04-11":[["III","Hl. Leo der Große"]],"04-13":[["III","Hl. Hermenegild"]],"04-14":[["III","Hl. Justin"],["C","Hll. Tiburtius, Valerian und Maximus"]],"04-17":[["C","Hl. Anicetus"]],"04-21":[["III","Hl. Anselm"]],"04-22":[["III","Hl. Soter und hl. Cajus"]],"04-23":[["C","Hl. Georg"]],"04-24":[["III","Hl. Fidelis von Sigmaringen"]],"04-25":[["II","Hl. Markus, Evangelist"]],"04-26":[["III","Hl. Kletus und hl. Marcellinus"]],"04-27":[["III","Hl. Petrus Canisius"]],"04-28":[["III","Hl. Paul vom Kreuz"]],"04-29":[["III","Hl. Petrus von Verona"]],"04-30":[["III","Hl. Katharina von Siena"]],"05-01":[["I","Hl. Josef der Arbeiter"]],"05-02":[["III","Hl. Athanasius"]],"05-03":[["C","Hll. Alexander, Eventius und Theodul"],["C","Hl. Juvenal"]],"05-04":[["III","Hl. Monika"]],"05-05":[["III","Hl. Pius V."]],"05-07":[["III","Hl. Stanislaus"]],"05-09":[["III","Hl. Gregor von Nazianz"]],"05-10":[["III","Hl. Antoninus"],["C","Hl. Gordian und hl. Epimachus"]],"05-11":[["II","Hl. Philippus und hl. Jakobus, Apostel"]],"05-12":[["III","Hll. Nereus, Achilleus, Domitilla und Pankratius"]],"05-13":[["III","Hl. Robert Bellarmin"]],"05-14":[["C","Hl. Bonifatius von Tarsus"]],"05-15":[["III","Hl. Johannes Baptist de La Salle"]],"05-16":[["III","Hl. Ubald"]],"05-17":[["III","Hl. Paschalis Baylon"]],"05-18":[["III","Hl. Venantius"]],"05-19":[["III","Hl. Petrus Cölestin"],["C","Hl. Pudentiana"]],"05-20":[["III","Hl. Bernhardin von Siena"]],"05-25":[["III","Hl. Gregor VII."],["C","Hl. Urban I."]],"05-26":[["III","Hl. Philipp Neri"],["C","Hl. Eleutherius"]],"05-27":[["III","Hl. Beda der Ehrwürdige"],["C","Hl. Johannes I."]],"05-28":[["III","Hl. Augustinus von Canterbury"]],"05-29":[["III","Hl. Maria Magdalena von Pazzi"]],"05-30":[["C","Hl. Felix I."]],"05-31":[["II","Maria Königin"],["C","Hl. Petronilla"]],"06-01":[["III","Hl. Angela Merici"]],"06-02":[["C","Hll. Marcellinus, Petrus und Erasmus"]],"06-04":[["III","Hl. Franz Caracciolo"]],"06-05":[["III","Hl. Bonifatius"]],"06-06":[["III","Hl. Norbert"]],"06-09":[["C","Hl. Primus und hl. Felicianus"]],"06-10":[["III","Hl. Margareta von Schottland"]],"06-11":[["III","Hl. Barnabas, Apostel"]],"06-12":[["III","Hl. Johannes von Sahagún"],["C","Hll. Basilides, Cyrinus, Nabor und Nazarius"]],"06-13":[["III","Hl. Antonius von Padua"]],"06-14":[["III","Hl. Basilius der Große"]],"06-15":[["C","Hll. Vitus, Modestus und Crescentia"]],"06-17":[["III","Hl. Gregor Barbarigo"]],"06-18":[["III","Hl. Ephräm der Syrer"],["C","Hl. Markus und hl. Marcellianus"]],"06-19":[["III","Hl. Juliana Falconieri"],["C","Hl. Gervasius und hl. Protasius"]],"06-20":[["C","Hl. Silverius"]],"06-21":[["III","Hl. Aloisius Gonzaga"]],"06-22":[["III","Hl. Paulinus von Nola"]],"06-23":[["II","Vigil von Johannes dem Täufer"]],"06-24":[["I","Geburt des hl. Johannes des Täufers"]],"06-25":[["III","Hl. Wilhelm von Vercelli"]],"06-26":[["III","Hl. Johannes und hl. Paulus"]],"06-28":[["II","Vigil von Petrus und Paulus"]],"06-29":[["I","Hl. Petrus und hl. Paulus, Apostel"]],"06-30":[["III","Gedächtnis des hl. Paulus"]],"07-01":[["I","Kostbares Blut unseres Herrn Jesus Christus"]],"07-02":[["II","Mariä Heimsuchung"],["C","Hl. Processus und hl. Martinian"]],"07-03":[["III","Hl. Irenäus"]],"07-05":[["III","Hl. Antonius Maria Zaccaria"]],"07-07":[["III","Hl. Cyrill und hl. Methodius"]],"07-08":[["III","Hl. Elisabeth von Portugal"]],"07-10":[["III","Hll. Sieben Brüder"],["C","Hl. Rufina und hl. Secunda"]],"07-11":[["C","Hl. Pius I."]],"07-12":[["III","Hl. Johannes Gualbertus"],["C","Hl. Nabor und hl. Felix"]],"07-14":[["III","Hl. Bonaventura"]],"07-15":[["III","Hl. Heinrich II."]],"07-16":[["C","Unsere Liebe Frau auf dem Berge Karmel"]],"07-17":[["C","Hl. Alexius"]],"07-18":[["III","Hl. Kamillus von Lellis"],["C","Hl. Symphorosa und ihre sieben Söhne"]],"07-19":[["III","Hl. Vinzenz von Paul"]],"07-20":[["III","Hl. Hieronymus Ämiliani"],["C","Hl. Margareta"]],"07-21":[["III","Hl. Laurentius von Brindisi"]],"07-22":[["III","Hl. Maria Magdalena"]],"07-23":[["III","Hl. Apollinaris"]],"07-24":[["C","Hl. Christina"]],"07-25":[["II","Hl. Jakobus, Apostel"]],"07-26":[["II","Hl. Anna"]],"07-27":[["C","Hl. Pantaleon"]],"07-28":[["III","Hll. Nazarius, Celsus, Viktor I. und Innozenz I."]],"07-29":[["III","Hl. Marta"]],"07-30":[["C","Hl. Abdon und hl. Sennen"]],"07-31":[["III","Hl. Ignatius von Loyola"]],"08-01":[["C","Hll. Makkabäische Brüder"]],"08-02":[["III","Hl. Alfons Maria von Liguori"],["C","Hl. Stephan I."]],"08-04":[["III","Hl. Dominikus"]],"08-05":[["III","Weihe der Kirche Maria Schnee"]],"08-06":[["II","Verklärung des Herrn"],["C","Hll. Xystus II., Felicissimus und Agapitus"]],"08-07":[["III","Hl. Kajetan"],["C","Hl. Donatus"]],"08-08":[["III","Hl. Johannes Maria Vianney"],["C","Hll. Cyriakus, Largus und Smaragdus"]],"08-09":[["III","Vigil des hl. Laurentius"],["C","Hl. Romanus"]],"08-10":[["II","Hl. Laurentius"]],"08-11":[["C","Hl. Tiburtius und hl. Susanna"]],"08-12":[["III","Hl. Klara"]],"08-13":[["C","Hl. Hippolyt und hl. Cassian"]],"08-14":[["II","Vigil von Mariä Himmelfahrt"],["C","Hl. Eusebius"]],"08-15":[["I","Mariä Himmelfahrt"]],"08-16":[["II","Hl. Joachim"]],"08-17":[["III","Hl. Hyazinth"]],"08-18":[["C","Hl. Agapitus"]],"08-19":[["III","Hl. Johannes Eudes"]],"08-20":[["III","Hl. Bernhard von Clairvaux"]],"08-21":[["III","Hl. Johanna Franziska von Chantal"]],"08-22":[["II","Unbeflecktes Herz Mariä"],["C","Hl. Timotheus und Gefährten"]],"08-23":[["III","Hl. Philippus Benitius"]],"08-24":[["II","Hl. Bartholomäus, Apostel"]],"08-25":[["III","Hl. Ludwig IX."]],"08-26":[["C","Hl. Zephyrinus"]],"08-27":[["III","Hl. Josef von Calasanz"]],"08-28":[["III","Hl. Augustinus"],["C","Hl. Hermes"]],"08-29":[["III","Enthauptung Johannes des Täufers"],["C","Hl. Sabina"]],"08-30":[["III","Hl. Rosa von Lima"],["C","Hl. Felix und hl. Adauctus"]],"08-31":[["III","Hl. Raimund Nonnatus"]],"09-01":[["C","Hl. Ägidius"],["C","Hll. Zwölf Brüder"]],"09-02":[["III","Hl. Stephan von Ungarn"]],"09-03":[["III","Hl. Pius X."]],"09-05":[["III","Hl. Laurentius Justinianus"]],"09-08":[["II","Mariä Geburt"],["C","Hl. Hadrian"]],"09-09":[["C","Hl. Gorgonius"]],"09-10":[["III","Hl. Nikolaus von Tolentino"]],"09-11":[["C","Hl. Protus und hl. Hyazinth"]],"09-12":[["III","Mariä Namen"]],"09-14":[["II","Kreuzerhöhung"]],"09-15":[["II","Sieben Schmerzen Mariens"],["C","Hl. Nikomedes"]],"09-16":[["III","Hl. Kornelius und hl. Cyprian"],["C","Hll. Euphemia, Lucia und Geminianus"]],"09-17":[["C","Wundmale des hl. Franziskus"]],"09-18":[["III","Hl. Josef von Copertino"]],"09-19":[["III","Hl. Januarius und Gefährten"]],"09-20":[["C","Hl. Eustachius und Gefährten"]],"09-21":[["II","Hl. Matthäus, Apostel und Evangelist"]],"09-22":[["III","Hl. Thomas von Villanova"],["C","Hl. Mauritius und Gefährten"]],"09-23":[["III","Hl. Linus"],["C","Hl. Thekla"]],"09-24":[["C","Unsere Liebe Frau vom Loskauf der Gefangenen"]],"09-26":[["C","Hl. Cyprian und hl. Justina"]],"09-27":[["III","Hl. Kosmas und hl. Damian"]],"09-28":[["III","Hl. Wenzel"]],"09-29":[["I","Weihe der Kirche des hl. Erzengels Michael"]],"09-30":[["III","Hl. Hieronymus"]],"10-01":[["C","Hl. Remigius"]],"10-02":[["III","Heilige Schutzengel"]],"10-03":[["III","Hl. Theresia vom Kinde Jesus"]],"10-04":[["III","Hl. Franz von Assisi"]],"10-05":[["C","Hl. Placidus und Gefährten"]],"10-06":[["III","Hl. Bruno"]],"10-07":[["II","Unsere Liebe Frau vom Rosenkranz"],["C","Hl. Markus"]],"10-08":[["III","Hl. Birgitta"],["C","Hll. Sergius, Bacchus, Marcellus und Apuleius"]],"10-09":[["III","Hl. Johannes Leonardi"],["C","Hll. Dionysius, Rustikus und Eleutherius"]],"10-10":[["III","Hl. Franz Borgia"]],"10-11":[["II","Mutterschaft Mariens"]],"10-13":[["III","Hl. Eduard der Bekenner"]],"10-14":[["III","Hl. Kallistus I."]],"10-15":[["III","Hl. Teresa von Ávila"]],"10-16":[["III","Hl. Hedwig"]],"10-17":[["III","Hl. Margareta Maria Alacoque"]],"10-18":[["II","Hl. Lukas, Evangelist"]],"10-19":[["III","Hl. Petrus von Alcantara"]],"10-20":[["III","Hl. Johannes von Krakau"]],"10-21":[["C","Hl. Hilarion"],["C","Hl. Ursula und Gefährtinnen"]],"10-23":[["III","Hl. Antonius Maria Claret"]],"10-24":[["III","Hl. Erzengel Raphael"]],"10-25":[["C","Hl. Chrysanthus und hl. Daria"]],"10-26":[["C","Hl. Evaristus"]],"10-28":[["II","Hl. Simon und hl. Judas, Apostel"]],"11-01":[["I","Allerheiligen"]],"11-02":[["I","Allerseelen"]],"11-04":[["III","Hl. Karl Borromäus"],["C","Hl. Vitalis und hl. Agricola"]],"11-08":[["C","Hll. Vier Gekrönte"]],"11-09":[["II","Weihe der Lateranbasilika"],["C","Hl. Theodor"]],"11-10":[["III","Hl. Andreas Avellino"],["C","Hll. Tryphon, Respicius und Nympha"]],"11-11":[["III","Hl. Martin von Tours"],["C","Hl. Menas"]],"11-12":[["III","Hl. Martin I."]],"11-13":[["III","Hl. Didakus"]],"11-14":[["III","Hl. Josaphat"]],"11-15":[["III","Hl. Albert der Große"]],"11-16":[["III","Hl. Gertrud"]],"11-17":[["III","Hl. Gregor der Wundertäter"]],"11-18":[["III","Weihe der Basiliken St. Peter und St. Paul"]],"11-19":[["III","Hl. Elisabeth von Thüringen"],["C","Hl. Pontianus"]],"11-20":[["III","Hl. Felix von Valois"]],"11-21":[["III","Mariä Opferung"]],"11-22":[["III","Hl. Cäcilia"]],"11-23":[["III","Hl. Klemens I."],["C","Hl. Felizitas"]],"11-24":[["III","Hl. Johannes vom Kreuz"],["C","Hl. Chrysogonus"]],"11-25":[["III","Hl. Katharina von Alexandrien"]],"11-26":[["III","Hl. Silvester Gozzolini"],["C","Hl. Petrus von Alexandrien"]],"11-29":[["C","Hl. Saturninus"]],"11-30":[["II","Hl. Andreas, Apostel"]],"12-02":[["III","Hl. Bibiana"]],"12-03":[["III","Hl. Franz Xaver"]],"12-04":[["III","Hl. Petrus Chrysologus"],["C","Hl. Barbara"]],"12-05":[["C","Hl. Sabbas"]],"12-06":[["III","Hl. Nikolaus"]],"12-07":[["III","Hl. Ambrosius"]],"12-08":[["I","Unbefleckte Empfängnis Mariens"]],"12-10":[["C","Hl. Melchiades"]],"12-11":[["III","Hl. Damasus I."]],"12-13":[["III","Hl. Luzia"]],"12-16":[["III","Hl. Eusebius von Vercelli"]],"12-21":[["II","Hl. Thomas, Apostel"]],"12-24":[["I","Heiliger Abend (Vigil von Weihnachten)"]],"12-25":[["I","Geburt des Herrn"]],"12-26":[["II","Hl. Stephanus"]],"12-27":[["II","Hl. Johannes, Apostel und Evangelist"]],"12-28":[["II","Unschuldige Kinder"]],"12-29":[["II","Tag in der Weihnachtsoktav"],["C","Hl. Thomas Becket"]],"12-30":[["II","Tag in der Weihnachtsoktav"]],"12-31":[["II","Tag in der Weihnachtsoktav"],["C","Hl. Silvester I."]]}};
function pron(src, style) {
  var ACC = '́';
  var s = src.normalize('NFD');
  // tokens: letters with accent flag
  var out = '';
  var words = s.split(/(\s+|[,.:;!?„“"]+)/);
  for (var wi = 0; wi < words.length; wi++) {
    var w = words[wi];
    if (!/[A-Za-z]/.test(w)) { out += w; continue; }
    var L = [];
    for (var i = 0; i < w.length; i++) {
      var ch = w[i];
      if (ch === ACC) { if (L.length) L[L.length - 1].acc = true; continue; }
      if (ch === '\u0308') { if (L.length) L[L.length - 1].hi = true; continue; }
      L.push({ c: ch.toLowerCase(), up: ch !== ch.toLowerCase(), acc: false });
    }
    var cap = L.length && L[0].up;
    var r = '';
    var isV = function (x) { return x && 'aeiouy'.indexOf(x.c) >= 0; };
    var front = function (k) { var x = L[k], y = L[k + 1]; if (!x) return false; if ('eiy'.indexOf(x.c) >= 0) return true; if ((x.c === 'a' || x.c === 'o') && y && y.c === 'e') return true; return false; };
    var a = function (txt, acc) { if (!acc) return txt; var m = txt.match(/[aeiouyäöü](?!.*[aeiouyäöü])/); if (!m) return txt + ACC; var p = txt.lastIndexOf(m[0]); return txt.slice(0, p + 1) + ACC + txt.slice(p + 1); };
    for (var k = 0; k < L.length; k++) {
      var x = L[k], n = L[k + 1], p = L[k - 1], c = x.c;
      if (c === 'c' && n && n.c === 'h') { r += 'k'; k++; continue; }
      if (c === 'p' && n && n.c === 'h') { r += 'f'; k++; continue; }
      if (c === 't' && n && n.c === 'h') { r += 't'; k++; continue; }
      if (c === 'h') { if (style === 'de') r += 'h'; continue; }
      if (c === 'q' && n && n.c === 'u') { r += 'kw'; k++; continue; }
      if (c === 'g' && n && n.c === 'n' && style === 'ro') { r += 'nj'; k++; continue; }
      if (c === 's' && n && n.c === 'c' && front(k + 2)) { r += (style === 'ro' ? 'sch' : 'sz'); k++; continue; }
      if (c === 'c' && n && n.c === 'c' && front(k + 2)) { r += (style === 'ro' ? 'ttsch' : 'kz'); k++; continue; }
      if (c === 'c') { r += front(k + 1) ? (style === 'ro' ? 'tsch' : 'z') : 'k'; continue; }
      if (c === 'g' && style === 'ro' && front(k + 1)) { r += (p && p.c === 'g') ? 'dsch' : 'dsch'; if (p && p.c === 'g') r = r.slice(0, -5) + 'ddsch'; continue; }
      if (c === 't' && n && n.c === 'i' && isV(L[k + 2]) && !(p && 'stx'.indexOf(p.c) >= 0)) { r += (style === 'ro' ? 'ts' : 'z'); continue; }
      if ((c === 'a' || c === 'o') && n && n.c === 'e' && !n.hi) { r += a(style === 'ro' ? 'e' : (c === 'a' ? 'ä' : 'ö'), x.acc || n.acc); k++; continue; }
      if (c === 'e' && k === 0 && n && n.c === 'u') { r += a('e', x.acc) + '·' + a('u', n.acc); k++; continue; }
      if ((c === 'i' || c === 'j') && ((k === 0 && isV(n)) || (isV(p) && isV(n)))) { r += 'j'; continue; }
      if (c === 'j') { r += 'j'; continue; }
      if (c === 'v') { r += 'w'; continue; }
      if (c === 'x') { r += (style === 'ro' ? 'ks' : 'x'); continue; }
      if (c === 'z') { r += (style === 'ro' ? 'ds' : 'z'); continue; }
      if (c === 'y') { r += a(style === 'ro' ? 'i' : 'ü', x.acc); continue; }
      r += a(c, x.acc);
    }
    r = r.normalize('NFC');
    if (cap) r = r.charAt(0).toUpperCase() + r.slice(1);
    out += r;
  }
  return out;
}
function plain(src) { return src.normalize('NFD').replace(/[́̈]/g, '').normalize('NFC'); }
function easterDate(y) {
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function litDayName(date) {
  var WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var DAY = 86400000;
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var y = d.getFullYear();
  var diff = function (a, b) { return Math.round((a - b) / DAY); };
  var add = function (a, n) { return new Date(a.getFullYear(), a.getMonth(), a.getDate() + n); };
  var adventStart = function (yy) { var c = new Date(yy, 11, 25); return add(c, -((c.getDay() || 7) + 21)); };
  var baptism = function (yy) { var e = new Date(yy, 0, 6); return add(e, 7 - e.getDay()); };
  var wd = WD[d.getDay()], sun = d.getDay() === 0;
  var easter = easterDate(y), ash = add(easter, -46), pent = add(easter, 49), adv = adventStart(y), bap = baptism(y);
  var nth = function (n, word) { return sun ? n + '. ' + word.replace('woche', 'sonntag').replace('Woche', 'Sonntag') : wd + ' der ' + n + '. ' + word; };
  if (d >= adv && d < new Date(y, 11, 25)) return sun ? (Math.floor(diff(d, adv) / 7) + 1) + '. Adventssonntag' : wd + ' der ' + (Math.floor(diff(d, adv) / 7) + 1) + '. Adventswoche';
  if (diff(d, bap) === 0) return 'Taufe des Herrn';
  if (diff(d, ash) === 0) return 'Aschermittwoch';
  var named = { '-3': 'Gründonnerstag', '-2': 'Karfreitag', '-1': 'Karsamstag', '0': 'Ostersonntag', '1': 'Ostermontag', '49': 'Pfingstsonntag' };
  if (named[String(diff(d, easter))]) return named[String(diff(d, easter))];
  if (d.getMonth() === 11 && d.getDate() === 25) return 'Hochfest der Geburt des Herrn';
  if (d.getMonth() === 11 && d.getDate() > 25) return (d.getDate() - 24) + '. Tag der Weihnachtsoktav';
  if (d.getMonth() === 0 && d.getDate() === 1) return 'Hochfest der Gottesmutter Maria';
  if (d.getMonth() === 0 && d.getDate() === 6) return 'Erscheinung des Herrn';
  if (d >= new Date(y, 11, 25) || d <= bap) return wd + ' der Weihnachtszeit';
  if (d < ash) { var w = Math.floor(diff(d, bap) / 7) + 1; return sun ? w + '. Sonntag im Jahreskreis' : wd + ' der ' + w + '. Woche im Jahreskreis'; }
  if (d < easter) {
    var lent1 = add(ash, 4);
    if (d < lent1) return wd + ' nach Aschermittwoch';
    var lw = Math.floor(diff(d, lent1) / 7) + 1;
    if (lw === 6) return sun ? 'Palmsonntag' : wd + ' der Karwoche';
    return sun ? lw + '. Fastensonntag' : wd + ' der ' + lw + '. Fastenwoche';
  }
  if (d <= pent) {
    var ew = Math.floor(diff(d, easter) / 7) + 1;
    if (ew === 1) return wd + ' der Osteroktav';
    return sun ? ew + '. Sonntag der Osterzeit' : wd + ' der ' + ew + '. Osterwoche';
  }
  var s = add(d, -d.getDay());
  var ow = 34 - Math.round(diff(add(adv, -7), s) / 7);
  return sun ? ow + '. Sonntag im Jahreskreis' : wd + ' der ' + ow + '. Woche im Jahreskreis';
}
// Schriftstellen je Geheimnis: vollständige Erzählabschnitte rund um die Kernverse
// der Rosenkranzseiten des Vatikans und der US-Bischofskonferenz
var BIBEL = {
 gaudiosa: ['Lk 1,26-38', 'Lk 1,39-56', 'Lk 2,1-20', 'Lk 2,22-40', 'Lk 2,41-52'],
 luminosa: ['Mt 3,13-17', 'Joh 2,1-11', 'Mk 1,14-15', 'Mt 17,1-9', 'Mt 26,26-29'],
 dolorosa: ['Mt 26,36-46', 'Mk 15,6-15', 'Mt 27,27-31', 'Lk 23,26-32', 'Lk 23,33-49'],
 gloriosa: ['Lk 24,1-12', 'Apg 1,6-11', 'Apg 2,1-13', 'Lk 1,46-55 · 1 Kor 15,20-26', 'Offb 12,1-6']
};
// Weitere Schriftstellen nach prayinglatin.com (Psalmen und Hoheslied auf die Zählung der Einheitsübersetzung umgerechnet,
// Sir und Jdt in Vulgata-Zählung belassen); für die lichtreichen Geheimnisse nennt die Seite keine Stellen
var BIBEL_MORE = {
 gaudiosa: ['Mt 1,18; Lk 1,26-38', 'Lk 1,39', 'Lk 2,6-19; 1 Kor 15,45-48', 'Lk 2,21-39', 'Lk 2,41-51'],
 luminosa: ['2 Kor 5,21; Mt 3,17 par.', 'Joh 2,1-12', 'Mk 1,15; Mk 2,3-13; Lk 7,47-48; Joh 20,22-23', 'Lk 9,35 par.', 'Joh 13,1'],
 dolorosa: ['Mt 26,36-57; Mk 14,32-52; Lk 22,39-54; Joh 18,1-12', 'Mt 27,26; Mk 15,6-15; Joh 19,1; Weish 2,12-20; Jes 50,6; 53,5',
   'Mt 27,22-31; Mk 15,17-20; Joh 19,2-8; Jes 63,2', 'Mt 27,32-33; Mk 15,20-22; Lk 9,22-26; 14,27; 23,26-31; Joh 19,16-22',
   'Mt 27,33-53; 24,13; Mk 15,24-40; Lk 23,32-49; 6,27-35; Joh 19,23-30; 14,6; 10,17; Ps 22,2.9-19'],
 gloriosa: ['Mt 27,62-65; 28,1-10; Mk 16,1-16; Lk 24,1-35; Joh 20,1-31', 'Mk 16,19; Lk 24,46-53; Apg 1,5-11; Röm 8,34',
   'Apg 1,13-2,42; Hebr 3,7-8; 1 Kor 2,12-15; Röm 8,7-13', 'Hld 2,10; 6,9; Ps 16,10; 45,10-12.14; 132,8',
   'Offb 11,19-12,1; Sir 24,23-31 (Vg); Jdt 16,10; 13,22-23 (Vg); Hld 6,10']
};
var MYST_STRESS = {
 gaudiosa: ['Annuntiátio', 'Visitátio', 'Natívitas', 'Praesentátio', 'Invéntio in Témplo'],
 luminosa: ['Baptísma ápud Iordánem', 'Autorevelátio ápud Canénse Matrimónium', 'Régni Déi Proclamátio', 'Transfigurátio', 'Eucharístiae Institútio'],
 dolorosa: ['Cruciátus in Hórto', 'Flagellátio', 'Coronátio cum Spínis', 'Baiulátio Crúcis', 'Crucifíxio'],
 gloriosa: ['Resurréctio', 'Ascénsio', 'Descénsus Spíritus Sáncti', 'Assúmptio', 'Coronátio']
};
var TRAD_STRESS = {
 gaudiosa: ['Annuntiátio', 'Visitátio', 'Natívitas', 'Purificátio', 'Invéntio in Témplo'],
 dolorosa: ['Agónia in Hórto', 'Flagellátio', 'Coronátio Spínis', 'Baiulátio Crúcis', 'Crucifíxio'],
 gloriosa: ['Resurréctio', 'Ascénsio', 'Descénsus Spíritus Sáncti', 'Assúmptio', 'Coronátio']
};

class Component extends DCLogic {
  renderVals() {
    var S = this.state || {};
    // Sprache der Gebete: DE, LA oder LA+ (Latein mit Aussprachehilfe)
    var langSel = S.lang || 'de';
    var lang = langSel === 'de' ? 'de' : 'la';
    var mode = S.mode || 'anf';
    var season = this.props.season ?? autoSeason(new Date());
    var self = this;

    // Erscheinungsbild: hell, dunkel oder System; optional liturgische Farbe als Akzent
    var themePref = S.theme || (this.props.erscheinungsbild ?? 'hell');
    var sysDark = false;
    try { sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) {}
    var dark = themePref === 'dunkel' || (themePref === 'system' && sysDark);
    var litOn = S.lit !== undefined ? S.lit : (this.props.liturgischeFarbe ?? false);
    var pronOn = langSel === 'la+';
    var pronStyle = S.pronStyle || (this.props.ausspracheStil ?? 'ro');
    var LIT = { jahreskreis: 'gruen', weihnachtszeit: 'weiss', osterzeit: 'weiss' };
    var ACCENTS = { rot: ['#9E2A20', '#9E2A20', '#E8907F', '#A8352A'], gruen: ['#2E6B3C', '#2E6B3C', '#86C495', '#2F6D3D'], weiss: ['#85631A', '#85631A', '#D9B866', '#7A5B16'] };
    var A = ACCENTS[litOn ? (LIT[season] || 'gruen') : 'rot'];
    var c = dark
      ? { paper: '#171512', card: '#221F1B', ink: '#EDE7DC', muted: '#A9A194', rule: '#3B362F', rule2: '#2E2A25', gold: '#D4B061', trackOff: '#5A544B', accentText: A[2], accentFill: A[3] }
      : { paper: '#F8F6F1', card: '#FFFFFF', ink: '#1D1B18', muted: '#5E5850', rule: '#DDD6CA', rule2: '#EAE4DA', gold: '#8A6417', trackOff: '#B8AFA2', accentText: A[0], accentFill: A[1] };
    var seg = function (opts, cur, key) {
      return opts.map(function (o) {
        var on = o[0] === cur;
        return { label: o[1], pressed: on ? 'true' : 'false', bg: on ? c.ink : c.card, fg: on ? c.paper : c.ink, pick: function () { var u = {}; u[key] = o[0]; self.setState(u); } };
      });
    };

    var T = {
      de: {
        app: 'Rosenkranz',
        today: 'Heute zu beten',
        selected: 'Ausgewählt',
        start: 'Rosenkranz beginnen',
        decadeHelp: 'Zu jedem Gesätz: ein Vaterunser, zehn Ave Maria mit dem Geheimnis nach „Jesus“, ein Ehre sei dem Vater.',
        modeAnf: 'Anfänger',
        modeFort: 'Fortgeschritten',
        modeBetr: 'Betrachtung',
        hintBetr: 'Still: nur die Geheimnisse mit ihren Bildern und Perlen zum Zählen, ohne Gebetstexte.',
        hintAnf: 'Geführt: alle Gebete im vollen Wortlaut, mit Hinweisen zu jedem Schritt.',
        hintFort: 'Kompakt: Gebete ohne Erklärungen. Die Texte lassen sich beim Beten ausblenden.',
        saintHeading: 'Heiliger des Tages',
        allHeading: 'Alle Geheimnisse',
        todayTag: 'Heute'
      }
    };
    var t = T.de;

    var M = {
      gaudiosa: {
        de: { name: 'Freudenreiche Geheimnisse', title: 'Die freudenreichen Geheimnisse', days: 'Montag · Samstag', decades: [
          'Jesus, den du, o Jungfrau, vom Heiligen Geist empfangen hast',
          'Jesus, den du, o Jungfrau, zu Elisabet getragen hast',
          'Jesus, den du, o Jungfrau, geboren hast',
          'Jesus, den du, o Jungfrau, im Tempel aufgeopfert hast',
          'Jesus, den du, o Jungfrau, im Tempel wiedergefunden hast'] },
        la: { name: 'Mysteria Gaudiosa', title: 'Mysteria Gaudiosa', adj: 'gaudiosum', days: 'Feria II · Sabbatum', decades: [
          'Annuntiatio',
          'Visitatio',
          'Nativitas',
          'Praesentatio',
          'Inventio in Templo'] }
      },
      luminosa: {
        de: { name: 'Lichtreiche Geheimnisse', title: 'Die lichtreichen Geheimnisse', days: 'Donnerstag', decades: [
          'Jesus, der von Johannes getauft worden ist',
          'Jesus, der sich bei der Hochzeit in Kana offenbart hat',
          'Jesus, der uns das Reich Gottes verkündet hat',
          'Jesus, der auf dem Berg verklärt worden ist',
          'Jesus, der uns die Eucharistie geschenkt hat'] },
        la: { name: 'Mysteria Luminosa', title: 'Mysteria Luminosa', adj: 'luminosum', days: 'Feria V', decades: [
          'Baptisma apud Iordanem',
          'Autorevelatio apud Canense Matrimonium',
          'Regni Dei Proclamatio',
          'Transfiguratio',
          'Eucharistiae Institutio'] }
      },
      dolorosa: {
        de: { name: 'Schmerzhafte Geheimnisse', title: 'Die schmerzhaften Geheimnisse', days: 'Dienstag · Freitag', decades: [
          'Jesus, der für uns Blut geschwitzt hat',
          'Jesus, der für uns gegeißelt worden ist',
          'Jesus, der für uns mit Dornen gekrönt worden ist',
          'Jesus, der für uns das schwere Kreuz getragen hat',
          'Jesus, der für uns gekreuzigt worden ist'] },
        la: { name: 'Mysteria Dolorosa', title: 'Mysteria Dolorosa', adj: 'dolorosum', days: 'Feria III · Feria VI', decades: [
          'Cruciatus in Horto',
          'Flagellatio',
          'Coronatio cum Spinis',
          'Baiulatio Crucis',
          'Crucifixio'] }
      },
      gloriosa: {
        de: { name: 'Glorreiche Geheimnisse', title: 'Die glorreichen Geheimnisse', days: 'Mittwoch · Sonntag', decades: [
          'Jesus, der von den Toten auferstanden ist',
          'Jesus, der in den Himmel aufgefahren ist',
          'Jesus, der uns den Heiligen Geist gesandt hat',
          'Jesus, der dich, o Jungfrau, in den Himmel aufgenommen hat',
          'Jesus, der dich, o Jungfrau, im Himmel gekrönt hat'] },
        la: { name: 'Mysteria Gloriosa', title: 'Mysteria Gloriosa', adj: 'gloriosum', days: 'Feria IV · Dominica', decades: [
          'Resurrectio',
          'Ascensio',
          'Descensus Spiritus Sancti',
          'Assumptio',
          'Coronatio'] }
      }
    };
    var alt = S.alt !== undefined ? S.alt : (this.props.altRhythmus ?? false);
    var trad = S.trad !== undefined ? S.trad : (this.props.traditionell ?? false);
    var cal62 = S.cal62 !== undefined ? S.cal62 : (this.props.kalender1962 ?? false);
    var calOpen = S.calOpen !== undefined ? S.calOpen : ((this.props.startansicht ?? 'start') === 'kalender');

    // Tagesheilige
    var RANK_REG = { H: 'Hochfest', F: 'Fest', G: 'Gebotener Gedenktag', g: 'Nicht gebotener Gedenktag' };
    var RANK_62 = { I: 'Fest I. Klasse', II: 'Fest II. Klasse', III: 'Fest III. Klasse', C: 'Kommemoration' };
    var ORDER = { H: 0, F: 1, G: 2, g: 3, I: 0, II: 1, III: 2, C: 3 };
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function dayInfo(m, d) {
      var key = pad(m + 1) + '-' + pad(d);
      var list = (cal62 ? SAINTS.c62 : SAINTS.reg)[key];
      if (list && list.length) {
        var sorted = list.slice().sort(function (a, b) { return ORDER[a[0]] - ORDER[b[0]]; });
        var others = sorted.slice(1).map(function (e) { return e[1]; });
        return { name: sorted[0][1], rank: (cal62 ? RANK_62 : RANK_REG)[sorted[0][0]], hasOthers: others.length > 0, others: others.join(', ') };
      }
      if (cal62) return { name: 'Feria', rank: 'Kein Fest im Kalender von 1962', hasOthers: false, others: '' };
      var dt = new Date(new Date().getFullYear(), m, d);
      var ln = litDayName(dt);
      var SPECIAL = { 'Taufe des Herrn': 'Fest', 'Ostersonntag': 'Hochfest', 'Pfingstsonntag': 'Hochfest', 'Ostermontag': 'Tag in der Osteroktav',
        'Aschermittwoch': 'Beginn der Fastenzeit', 'Gründonnerstag': 'Österliches Triduum', 'Karfreitag': 'Österliches Triduum', 'Karsamstag': 'Österliches Triduum' };
      return { name: ln, rank: SPECIAL[ln] || (dt.getDay() === 0 ? 'Sonntag' : 'Wochentag'), hasOthers: false, others: '' };
    }

    // Ältere lateinische Bezeichnungen (nur Latein; lichtreiche gibt es in dieser Form nicht)
    var TRAD = {
      gaudiosa: ['Annuntiatio', 'Visitatio', 'Nativitas', 'Purificatio', 'Inventio in Templo'],
      dolorosa: ['Agonia in Horto', 'Flagellatio', 'Coronatio Spinis', 'Baiulatio Crucis', 'Crucifixio'],
      gloriosa: ['Resurrectio', 'Ascensio', 'Descensus Spiritus Sancti', 'Assumptio', 'Coronatio']
    };
    var ALTDAYS = { gaudiosa: 'Montag · Donnerstag', dolorosa: 'Dienstag · Freitag', gloriosa: 'Mittwoch · Samstag · Sonntag' };

    var orderKeys = alt ? ['gaudiosa', 'dolorosa', 'gloriosa'] : ['gaudiosa', 'luminosa', 'dolorosa', 'gloriosa'];

    var now = new Date();
    var wd = now.getDay();
    var todayKey = alt
      ? ['gloriosa', 'gaudiosa', 'dolorosa', 'gloriosa', 'gaudiosa', 'dolorosa', 'gloriosa'][wd]
      : ['gloriosa', 'gaudiosa', 'dolorosa', 'gloriosa', 'luminosa', 'dolorosa', 'gaudiosa'][wd];
    var sel = S.sel || todayKey;
    if (alt && sel === 'luminosa') sel = todayKey;

    var daysDe = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    var monthsDe = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    // Kopfzeile: echtes Datum; auf den Beispiel-Startseiten ein Beispieltag der jeweiligen Zeit
    var hd = now;
    if (this.props.season === 'weihnachtszeit') hd = new Date(now.getFullYear(), 11, 29);
    if (this.props.season === 'osterzeit') { var ed = easterDate(now.getFullYear()); hd = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() + 19); }
    var dateLabel = daysDe[hd.getDay()] + ', ' + hd.getDate() + '. ' + monthsDe[hd.getMonth()];
    var litDayLabel = litDayName(hd);

    var SEASONS = {
      jahreskreis: { color: '#2E6B3C', de: 'Zeit im Jahreskreis', la: 'Tempus per annum', ph: '[Platzhalter: Zeit im Jahreskreis]' },
      weihnachtszeit: { color: '#8A6417', de: 'Weihnachtszeit', la: 'Tempus Nativitatis', ph: '[Platzhalter: Weihnachtszeit]' },
      osterzeit: { color: '#8A6417', de: 'Osterzeit', la: 'Tempus Paschale', ph: '[Platzhalter: Osterzeit]' }
    };
    var s = SEASONS[season] || SEASONS.jahreskreis;

    var heroData = M[sel][lang];
    var title = heroData.title;
    var nums = ['I', 'II', 'III', 'IV', 'V'];
    var hero = {
      initial: title.charAt(0),
      rest: title.slice(1),
      decades: ((lang === 'la' && trad && TRAD[sel]) ? TRAD[sel] : heroData.decades).map(function (txt, i) {
        var stressed = (lang === 'la') ? ((trad && TRAD_STRESS[sel]) ? TRAD_STRESS[sel][i] : MYST_STRESS[sel][i]) : '';
        var showPron = lang === 'la' && pronOn && !!stressed;
        return { num: nums[i], text: txt, hasPron: showPron, pron: showPron ? pron(stressed, pronStyle) : '', ref: BIBEL[sel][i], hasMore: !!BIBEL_MORE[sel][i], more: BIBEL_MORE[sel][i] ? (sel === 'luminosa' ? 'Johannes Paul II., Rosarium Virginis Mariae 21: ' : 'Weitere Stellen: ') + BIBEL_MORE[sel][i] : '' };
      })
    };

    var langs = [
      { id: 'de', label: 'DE' },
      { id: 'la', label: 'LA' },
      { id: 'la+', label: 'LA+' }
    ].map(function (o) {
      var on = o.id === langSel;
      return { label: o.label, pressed: on ? 'true' : 'false', bg: on ? c.ink : c.card, fg: on ? c.paper : c.ink, pick: function () { self.setState({ lang: o.id }); } };
    });

    var modes = [
      { id: 'anf', label: t.modeAnf },
      { id: 'fort', label: t.modeFort },
      { id: 'betr', label: t.modeBetr }
    ].map(function (o) {
      var on = o.id === mode;
      return { label: o.label, pressed: on ? 'true' : 'false', bg: on ? c.ink : c.card, fg: on ? c.paper : c.ink, pick: function () { self.setState({ mode: o.id }); } };
    });

    var mysteries = orderKeys.map(function (k) {
      var on = k === sel;
      return {
        name: M[k][lang].name,
        days: alt ? ALTDAYS[k] : M[k].de.days,
        isToday: k === todayKey,
        pressed: on ? 'true' : 'false',
        borderColor: on ? c.ink : c.rule,
        ring: on ? 'inset 0 0 0 1px ' + c.ink : 'none',
        pick: function () { self.setState({ sel: k }); }
      };
    });

    var toggles = [
      { id: 'opt-rhythmus', key: 'alt', on: alt, label: 'Alter Rhythmus',
        desc: 'Wochenplan vor 2002: Montag und Donnerstag freudenreich, Dienstag und Freitag schmerzhaft, Mittwoch, Samstag und Sonntag glorreich. Ohne lichtreiche Geheimnisse.' },
      { id: 'opt-traditionell', key: 'trad', on: trad, label: 'Traditionelle Bezeichnungen',
        desc: 'Lateinische Namen der Geheimnisse in der älteren Form, zum Beispiel Agonia in Horto.' },
      { id: 'opt-kalender', key: 'cal62', on: cal62, label: 'Kalender von 1962',
        desc: 'Tagesheilige nach dem Kalender der außerordentlichen Form statt nach dem Regionalkalender für das deutsche Sprachgebiet.' },
      { id: 'opt-litfarbe', key: 'lit', on: litOn, label: 'Liturgische Farbe',
        desc: 'Färbt Knöpfe und Hervorhebungen in der Farbe der Zeit im Kirchenjahr, in hellem wie dunklem Erscheinungsbild.' }
    ].map(function (o) {
      return {
        id: o.id, label: o.label, desc: o.desc,
        checked: o.on ? 'true' : 'false',
        track: o.on ? c.accentFill : c.trackOff,
        justify: o.on ? 'flex-end' : 'flex-start',
        toggle: function () { var u = {}; u[o.key] = !o.on; self.setState(u); }
      };
    });

    var monthsCal = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    var wdShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    var year = now.getFullYear();
    var calMonth = S.calMonth !== undefined ? S.calMonth : now.getMonth();
    var daysInMonth = new Date(year, calMonth + 1, 0).getDate();
    var monthDays = [];
    for (var dd = 1; dd <= daysInMonth; dd++) {
      var info = dayInfo(calMonth, dd);
      var isToday = calMonth === now.getMonth() && dd === now.getDate();
      monthDays.push({ day: dd, wd: wdShort[new Date(year, calMonth, dd).getDay()], name: info.name, rank: info.rank,
        hasOthers: info.hasOthers, others: info.others, bg: isToday ? c.card : 'transparent', numColor: isToday ? c.accentText : c.ink });
    }

    // Titelbild: erstes Geheimnis der gewählten Reihe, Variante wechselt täglich
    var HERO = {
      gaudiosa: [['img/freud-1-a.jpg', 'Fra Angelico, Verkündigung'], ['img/freud-1-b.jpg', 'Leonardo da Vinci, Verkündigung'], ['img/freud-1-c.jpg', 'Henry Ossawa Tanner, Die Verkündigung']],
      luminosa: [['img/licht-1-a.jpg', 'Piero della Francesca, Taufe Christi'], ['img/licht-1-b.jpg', 'Verrocchio und Leonardo, Taufe Christi'], ['img/licht-1-c.jpg', 'Gerard David, Taufe Christi']],
      dolorosa: [['img/schmerz-1-a.jpg', 'Andrea Mantegna, Christus am Ölberg'], ['img/schmerz-1-b.jpg', 'Giovanni Bellini, Christus am Ölberg'], ['img/schmerz-1-c.jpg', 'El Greco, Christus am Ölberg']],
      gloriosa: [['img/glor-1-a.jpg', 'Piero della Francesca, Auferstehung'], ['img/glor-1-b.jpg', 'Matthias Grünewald, Auferstehung'], ['img/glor-1-c.jpg', 'Fra Angelico, Noli me tangere']]
    };
    var doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    var hv = HERO[sel][doy % 3];

    return {
      c: c,
      prayerOpen: !!S.prayer,
      openPrayer: function () { try { window.scrollTo(0, 0); } catch (e) {} self.setState({ prayer: true }); },
      closePrayer: function () { self.setState({ prayer: false }); },
      mode: mode, sel: sel, themePref: themePref, litOn: litOn, season: season,
      pronAttr: pronOn ? pronStyle : 'aus',
      pronStyle: pronStyle,
      themes: seg([['hell', 'Hell'], ['dunkel', 'Dunkel'], ['system', 'System']], themePref, 'theme'),
      pronOn: pronOn,
      pronStyles: seg([['ro', 'Römisch'], ['de', 'Deutsch']], pronStyle, 'pronStyle'),
      pronStyleHint: 'Wählst du oben LA+, steht unter jedem lateinischen Text, wie er gesprochen wird; betonte Silben tragen einen Akzent. ' + (pronStyle === 'ro' ? 'Römisch: italienische Kirchenaussprache, caeli wie „tschéli“.' : 'Deutsch: Schultradition, caeli wie „zäli“.'),
      heroImg: { src: hv[0], alt: hv[1] },
      saint: dayInfo(now.getMonth(), now.getDate()),
      calendarOpen: calOpen,
      openCalendar: function () { try { window.scrollTo(0, 0); } catch (e) {} self.setState({ calOpen: true, calMonth: now.getMonth() }); },
      closeCalendar: function () { self.setState({ calOpen: false }); },
      prevMonth: function () { self.setState({ calMonth: (calMonth + 11) % 12 }); },
      nextMonth: function () { self.setState({ calMonth: (calMonth + 1) % 12 }); },
      monthLabel: monthsCal[calMonth] + ' ' + year,
      monthDays: monthDays,
      calSourceLabel: cal62 ? 'Kalender von 1962' : 'Regionalkalender für das deutsche Sprachgebiet',
      settingsOpen: !!S.settings,
      openSettings: function () { self.setState({ settings: true }); },
      closeSettings: function () { self.setState({ settings: false }); },
      toggles: toggles,
      t: t,
      lang: lang,
      langs: langs,
      modes: modes,
      modeHint: mode === 'anf' ? t.hintAnf : (mode === 'betr' ? t.hintBetr : t.hintFort),
      isBeginner: mode === 'anf',
      dateLabel: dateLabel,
      litDayLabel: litDayLabel,
      seasonColor: s.color,
      seasonName: s.de,
      seasonPlaceholder: '', offlineText: window.__rkOfflineText || '', hasOffline: !!window.__rkOfflineText,
      heroLabel: sel === todayKey ? t.today : t.selected,
      hero: hero,
      mysteries: mysteries
    };
  }
}

return Component;
})(), ["lang", "mode", "theme", "lit", "pronStyle", "alt", "trad", "cal62"]);
DC.mount('Main', document.getElementById('app'));

// Hintergrund und Statusleiste folgen dem Erscheinungsbild der App
(function () {
  var app = document.getElementById('app');
  var meta = document.querySelector('meta[name="theme-color"]');
  function sync() {
    var r = app.firstElementChild;
    var bg = r && r.style.background;
    if (bg) { document.documentElement.style.setProperty('--bg', bg); if (meta) meta.setAttribute('content', bg); }
  }
  new MutationObserver(sync).observe(app, { childList: true });
  sync();
})();

// Offline-Betrieb: Grundgerüst sofort, Bilder nach und nach (auch über mehrere Starts)
(function () {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  var IMGS = ["img/freud-1-a.jpg", "img/freud-1-b.jpg", "img/freud-1-c.jpg", "img/freud-2-a.jpg", "img/freud-2-b.jpg", "img/freud-2-c.jpg", "img/freud-3-a.jpg", "img/freud-3-b.jpg", "img/freud-3-c.jpg", "img/freud-4-a.jpg", "img/freud-4-b.jpg", "img/freud-4-c.jpg", "img/freud-5-a.jpg", "img/freud-5-b.jpg", "img/freud-5-c.jpg", "img/glor-1-a.jpg", "img/glor-1-b.jpg", "img/glor-1-c.jpg", "img/glor-2-a.jpg", "img/glor-2-b.jpg", "img/glor-2-c.jpg", "img/glor-3-a.jpg", "img/glor-3-b.jpg", "img/glor-3-c.jpg", "img/glor-4-a.jpg", "img/glor-4-b.jpg", "img/glor-4-c.jpg", "img/glor-5-a.jpg", "img/glor-5-b.jpg", "img/glor-5-c.jpg", "img/licht-1-a.jpg", "img/licht-1-b.jpg", "img/licht-1-c.jpg", "img/licht-2-a.jpg", "img/licht-2-b.jpg", "img/licht-2-c.jpg", "img/licht-3-a.jpg", "img/licht-3-b.jpg", "img/licht-3-c.jpg", "img/licht-4-a.jpg", "img/licht-4-b.jpg", "img/licht-4-c.jpg", "img/licht-5-a.jpg", "img/licht-5-b.jpg", "img/licht-5-c.jpg", "img/schmerz-1-a.jpg", "img/schmerz-1-b.jpg", "img/schmerz-1-c.jpg", "img/schmerz-2-a.jpg", "img/schmerz-2-b.jpg", "img/schmerz-2-c.jpg", "img/schmerz-3-a.jpg", "img/schmerz-3-b.jpg", "img/schmerz-3-c.jpg", "img/schmerz-4-a.jpg", "img/schmerz-4-b.jpg", "img/schmerz-4-c.jpg", "img/schmerz-5-a.jpg", "img/schmerz-5-b.jpg", "img/schmerz-5-c.jpg"];
  function setText(t) { window.__rkOfflineText = t; DC.refresh(); }
  function recount() {
    if (!window.caches) return;
    Promise.all(IMGS.map(function (u) { return caches.match(u); })).then(function (r) {
      var n = r.filter(Boolean).length, total = IMGS.length;
      setText(n === total
        ? 'Die App und alle ' + total + ' Bilder sind auf diesem Gerät gespeichert. Sie funktioniert auch ohne Internet.'
        : n + ' von ' + total + ' Bildern sind gespeichert. Die übrigen werden geladen, solange die App geöffnet und mit dem Internet verbunden ist.');
    }).catch(function () {});
  }
  navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'progress') recount(); });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.ready.then(function (reg) {
      recount();
      if (reg.active) reg.active.postMessage('fill');
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('fill');
  });
})();
