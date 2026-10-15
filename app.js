'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ============ CONEXIÓN CON SUPABASE ============
const CFG = window.POS_CONFIG || {};
const configurado = /^https:\/\/[^/\s]+$/.test(CFG.SUPABASE_URL || '') && CFG.SUPABASE_KEY && !/PEGA/.test(CFG.SUPABASE_URL + CFG.SUPABASE_KEY);
const sb = configurado ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

let U = null, NEG = null, PERFIL = null, vista = 'dashboard', carrito = [], PRODS = [], CAJAS = [], cajaSel = null;
let enSistema = false, recuperando = /type=recovery/.test(location.hash);

const m = n => esc(NEG.moneda) + Number(n).toFixed(2);
const mt = n => NEG.moneda + Number(n).toFixed(2);
const fecha = d => new Date(d).toLocaleString('es');
const pintar = (v, html) => { if (vista === v) $('#app').innerHTML = html; };
const h = (fn, ...a) => Promise.resolve().then(() => fn(...a)).catch(e => aviso(e.message, true));
const nombreCorto = () => (PERFIL ? PERFIL.usuario : (U && U.email ? U.email.split('@')[0] : 'cajero'));
const esAdmin = () => !!(PERFIL && PERFIL.rol === 'admin');

function tr(msg) {
  msg = String(msg || '');
  const t = [
    [/Invalid login credentials/i, 'Correo o contraseña incorrectos'],
    [/User already registered/i, 'Ese correo ya tiene una cuenta'],
    [/Email not confirmed/i, 'Debes confirmar tu correo antes de entrar (revisa tu bandeja y el spam)'],
    [/Password should be at least/i, 'La contraseña es muy corta (mínimo 8 caracteres)'],
    [/Unable to validate email|invalid format|is invalid/i, 'El correo no es válido'],
    [/rate limit|too many/i, 'Demasiados intentos. Espera unos minutos.'],
    [/Signups not allowed|signups are disabled/i, 'El registro de cuentas nuevas está desactivado'],
    [/duplicate key/i, 'Ese código ya existe'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Sin conexión con el servidor. Revisa tu internet.'],
    [/JWT|token is expired|not authenticated/i, 'Tu sesión expiró. Inicia sesión de nuevo.'],
    [/new password should be different/i, 'La nueva contraseña debe ser diferente a la anterior'],
    [/Could not find the function|schema cache/i, 'Falta ejecutar el archivo multiusuario.sql en Supabase (SQL Editor)'],
    [/row-level security|permission denied/i, 'No tienes permiso para hacer esto (solo administradores)']
  ];
  for (const [re, txt] of t) if (re.test(msg)) return txt;
  return msg;
}
async function q(p) {
  const { data, error } = await p;
  if (error) throw new Error(tr(error.message));
  return data;
}
async function todo(tabla) { // trae todas las filas (de 1000 en 1000)
  let out = [], desde = 0;
  for (;;) {
    const r = await q(sb.from(tabla).select('*').order('id').range(desde, desde + 999));
    out = out.concat(r);
    if (r.length < 1000) return out;
    desde += 1000;
  }
}
function aviso(texto, error) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' err' : '');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), error ? 5000 : 4000);
}

// ============ PANTALLAS DE ACCESO ============
function ventanaAuth(html) {
  $('#shell').hidden = true;
  const a = $('#auth'); a.hidden = false;
  a.innerHTML = `<div class="authbox"><h1>🛒 Mi POS</h1>${html}</div>`;
  a.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') { const b = a.querySelector('button.btn'); if (b) b.click(); } });
  return a;
}
function pantallaConfig() {
  ventanaAuth(`<p class="msg">Falta conectar la base de datos.<br><br>Abre el archivo <b>config.js</b>, pega tu <b>Project URL</b> y tu <b>clave pública</b> de Supabase, guarda y recarga esta página.<br><br>Las instrucciones están en <b>LEEME.md</b>.</p>`);
}
function pantallaAuth(modo, mensaje) {
  enSistema = false;
  const a = ventanaAuth({
    login: `<p>¡Bienvenido de vuelta! Inicia sesión</p>
      <input id="a_mail" type="text" placeholder="Usuario o correo" autocomplete="username" autocapitalize="none">
      <input id="a_pass" type="password" placeholder="Contraseña" autocomplete="current-password">
      <div id="a_err" class="err"></div>
      <button class="btn" id="a_ok">Entrar a mi oficina</button>
      <p><a href="#" id="a_olv">Olvidé mi contraseña</a></p>
      <p>¿No tienes una cuenta? <a href="#" id="a_sw">Crear cuenta</a></p>`,
    registro: `<p>Crea tu cuenta</p>
      <input id="a_mail" type="email" placeholder="Correo" autocomplete="username">
      <input id="a_pass" type="password" placeholder="Contraseña (mínimo 8 caracteres)" autocomplete="new-password">
      <input id="a_pass2" type="password" placeholder="Repetir contraseña" autocomplete="new-password">
      <div id="a_err" class="err"></div>
      <button class="btn" id="a_ok">Crear cuenta</button>
      <p>¿Ya tienes cuenta? <a href="#" id="a_sw">Inicia sesión</a></p>`,
    olvide: `<p>Te enviaremos un enlace para crear una contraseña nueva</p>
      <input id="a_mail" type="email" placeholder="Correo" autocomplete="username">
      <div id="a_err" class="err"></div>
      <button class="btn" id="a_ok">Enviar enlace</button>
      <p><a href="#" id="a_sw">Volver</a></p>`,
    nueva: `<p>Escribe tu nueva contraseña</p>
      <input id="a_pass" type="password" placeholder="Nueva contraseña (mínimo 8)" autocomplete="new-password">
      <input id="a_pass2" type="password" placeholder="Repetir contraseña" autocomplete="new-password">
      <div id="a_err" class="err"></div>
      <button class="btn" id="a_ok">Guardar contraseña</button>`,
    aviso: `<p class="ok">${esc(mensaje)}</p><button class="btn" id="a_ok">Ir a iniciar sesión</button>`
  }[modo]);
  const go = f => async () => { const b = $('#a_ok'); b.disabled = true; try { await f(); } catch (e) { const er = $('#a_err'); if (er) er.textContent = e.message; } b.disabled = false; };
  const sw = $('#a_sw'); if (sw) sw.onclick = e => { e.preventDefault(); pantallaAuth(modo === 'login' ? 'registro' : 'login'); };
  const ol = $('#a_olv'); if (ol) ol.onclick = e => { e.preventDefault(); pantallaAuth('olvide'); };
  $('#a_ok').onclick = go({ login: doLogin, registro: doRegistro, olvide: doOlvide, nueva: doNueva, aviso: async () => pantallaAuth('login') }[modo]);
  const f = $('#a_mail') || $('#a_pass'); if (f) f.focus();
}
const val = id => ($('#' + id).value || '').trim();
function chequearClaves() {
  const p = $('#a_pass').value;
  if (p.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (p !== $('#a_pass2').value) throw new Error('Las contraseñas no coinciden');
  return p;
}
async function doLogin() {
  let email = val('a_mail');
  if (!email) throw new Error('Escribe tu usuario o correo');
  if (!email.includes('@')) { // inició con nombre de usuario
    email = await q(sb.rpc('login_email', { p_usuario: email.toLowerCase() }));
    if (!email) throw new Error('Usuario o contraseña incorrectos');
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#a_pass').value });
  if (error) throw new Error(tr(error.message));
  await iniciar(data.user);
}
async function doRegistro() {
  const password = chequearClaves();
  const { data, error } = await sb.auth.signUp({ email: val('a_mail'), password });
  if (error) throw new Error(tr(error.message));
  if (data.session) await iniciar(data.user);
  else pantallaAuth('aviso', 'Te enviamos un correo para confirmar tu cuenta. Ábrelo (revisa también el spam) y luego inicia sesión. Si ya tenías cuenta, inicia sesión directamente.');
}
async function doOlvide() {
  const { error } = await sb.auth.resetPasswordForEmail(val('a_mail'), { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(tr(error.message));
  pantallaAuth('aviso', 'Si ese correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva.');
}
async function doNueva() {
  const password = chequearClaves();
  const { data, error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(tr(error.message));
  recuperando = false; history.replaceState(null, '', location.pathname);
  await iniciar(data.user);
}

// ============ INICIO DE SESIÓN Y NEGOCIO ============
async function iniciar(user) {
  if (recuperando) return;
  if (enSistema && U && U.id === user.id) return;
  U = user;
  PERFIL = await q(sb.rpc('mi_perfil'));
  const cfg = await q(sb.from('config').select('*').maybeSingle());
  if (cfg && !PERFIL) { await q(sb.rpc('registrar_dueno')); PERFIL = await q(sb.rpc('mi_perfil')); }
  if (!cfg) return pantallaNegocio();
  NEG = cfg; entrar();
}
function pantallaNegocio() {
  ventanaAuth(`<p>¡Cuenta lista! Ponle nombre a tu tienda</p>
    <input id="n_nom" placeholder="Nombre de tu tienda" maxlength="80">
    <div id="a_err" class="err"></div>
    <button class="btn" id="a_ok">Empezar</button>`);
  $('#n_nom').focus();
  $('#a_ok').onclick = async () => {
    const b = $('#a_ok'); b.disabled = true;
    try {
      const nombre = val('n_nom'); if (!nombre) throw new Error('Escribe el nombre de tu tienda');
      await q(sb.rpc('registrar_dueno'));
      await q(sb.from('config').insert({ nombre }));
      await q(sb.from('cajas').insert({ nombre: 'Caja 1' }));
      await iniciar(U);
    } catch (e) { $('#a_err').textContent = e.message; b.disabled = false; }
  };
}
function entrar() {
  enSistema = true; carrito = []; cajaSel = null; vista = 'dashboard';
  $('#auth').hidden = true; $('#auth').innerHTML = ''; $('#shell').hidden = false;
  menu(); render();
}
async function salir() {
  await sb.auth.signOut();
  U = null; NEG = null; PERFIL = null; pantallaAuth('login');
}

// ============ MENÚ ============
function menu() {
  const it = [['dashboard', '📊 Panel'], ['pos', '💳 Punto de venta'], ['cajas', '🗄️ Cajas'], ['productos', '📦 Productos', 1], ['ventas', '🧾 Ventas'], ['usuarios', '👥 Usuarios', 1], ['config', '⚙️ Configuración', 1], ['cuenta', '🔑 Mi cuenta']]
    .filter(x => !x[2] || esAdmin());
  $('#side').innerHTML = `<h1>🛒 ${esc(NEG.nombre)}</h1>` +
    it.map(([v, t]) => `<button class="${v === vista ? 'on' : ''}" onclick="ir('${v}')">${t}</button>`).join('') +
    `<div id="usr"><div>👤 ${esc(nombreCorto())} (${esc(PERFIL ? PERFIL.rol : 'admin')})</div><button onclick="h(salir)">🚪 Cerrar sesión</button></div>`;
}
function ir(v) { vista = v; menu(); render(); }
function render() {
  if (['productos', 'usuarios', 'config'].includes(vista) && !esAdmin()) vista = 'dashboard';
  const vistas = { dashboard: vDash, pos: vPOS, cajas: vCajas, productos: vProductos, ventas: vVentas, usuarios: vUsuarios, config: vConfig, cuenta: vCuenta };
  $('#app').innerHTML = '<p style="color:var(--gris)">Cargando…</p>';
  h(vistas[vista]);
}

// ============ PANEL ============
async function vDash() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const [r, cajas] = await Promise.all([q(sb.rpc('resumen_panel', { p_desde: t0.toISOString() })), q(sb.from('cajas').select('*').order('id'))]);
  pintar('dashboard', `<h2>Panel</h2>
  <div class="stats">
    <div class="stat"><small>Ventas de hoy</small><b>${m(r.ventas_hoy)}</b></div>
    <div class="stat"><small>Transacciones hoy</small><b>${r.num_hoy}</b></div>
    <div class="stat"><small>Productos</small><b>${r.productos}</b></div>
    <div class="stat"><small>Stock bajo (≤10)</small><b>${r.bajos.length}</b></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Cajas</h3><table><tr><th>Caja</th><th>Estado</th><th>Cajero</th></tr>
  ${cajas.map(c => `<tr><td>${esc(c.nombre)}</td><td><span class="badge ${c.abierta ? 'abierta' : 'cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td><td>${esc(c.cajero) || '-'}</td></tr>`).join('')}</table></div>
  ${r.bajos.length ? `<div class="card"><h3>⚠️ Stock bajo</h3>${r.bajos.map(p => `<div>${esc(p.nombre)}: <b>${p.stock}</b></div>`).join('')}</div>` : ''}`);
}

// ============ PUNTO DE VENTA ============
async function vPOS() {
  [PRODS, CAJAS] = await Promise.all([q(sb.from('productos').select('*')), q(sb.from('cajas').select('*').order('id'))]);
  PRODS.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const abiertas = CAJAS.filter(c => c.abierta);
  if (!abiertas.some(c => c.id === cajaSel)) cajaSel = (abiertas[0] || {}).id || null;
  if (!cajaSel) {
    pintar('pos', `<h2>Punto de venta</h2><div class="aviso">No hay ninguna caja abierta. Ve a <b>Cajas</b> y abre una para poder vender.</div>`);
    return;
  }
  const c = CAJAS.find(c => c.id === cajaSel);
  pintar('pos', `<h2>Punto de venta · ${esc(c.nombre)} <small style="color:var(--gris);font-weight:400">(${esc(c.cajero)})</small></h2>
  ${abiertas.length > 1 ? `<div class="row" style="margin-bottom:12px"><label>Caja: <select onchange="cajaSel=Number(this.value);h(vPOS)">${abiertas.map(x => `<option value="${x.id}" ${x.id === cajaSel ? 'selected' : ''}>${esc(x.nombre)} (${esc(x.cajero)})</option>`).join('')}</select></label></div>` : ''}
  <div class="pos">
    <div class="card">
      <input id="busq" placeholder="🔍 Buscar por nombre o escanear código..." style="width:100%" oninput="listaProd()" onkeydown="if(event.key==='Enter')escanear()">
      <div class="grid" id="lista"></div>
    </div>
    <div class="card" id="cart"></div>
  </div>`);
  listaProd(); pintarCarrito(); const b = $('#busq'); if (b) b.focus();
}
function listaProd() {
  const t = $('#busq').value.toLowerCase();
  const r = PRODS.filter(p => p.nombre.toLowerCase().includes(t) || p.codigo.toLowerCase().includes(t));
  $('#lista').innerHTML = r.map(p => `<div class="prod" onclick="addCarrito(${p.id})"><b>${esc(p.nombre)}</b><span>${m(p.precio)}</span><small>Stock: ${p.stock}</small></div>`).join('') || '<p>Sin resultados</p>';
}
function escanear() {
  const t = $('#busq').value.trim().toLowerCase(); const p = PRODS.find(p => p.codigo.toLowerCase() === t);
  if (p) { addCarrito(p.id); $('#busq').value = ''; listaProd(); }
}
function addCarrito(id) {
  const p = PRODS.find(p => p.id === id), it = carrito.find(i => i.id === id);
  if ((it ? it.cant : 0) + 1 > p.stock) return aviso('Stock insuficiente', true);
  it ? it.cant++ : carrito.push({ id, cant: 1 });
  pintarCarrito();
}
function cambiar(id, dlt) {
  const it = carrito.find(i => i.id === id), p = PRODS.find(p => p.id === id);
  it.cant += dlt;
  if (it.cant > p.stock) { it.cant = p.stock; aviso('Stock insuficiente', true); }
  if (it.cant <= 0) carrito = carrito.filter(i => i.id !== id);
  pintarCarrito();
}
function calc() {
  const sub = carrito.reduce((a, i) => a + PRODS.find(p => p.id === i.id).precio * i.cant, 0);
  const imp = Math.round(sub * NEG.impuesto) / 100;
  return { sub, imp, total: sub + imp };
}
function pintarCarrito() {
  const t = calc();
  $('#cart').innerHTML = `<h3>Carrito</h3>
  <table>${carrito.map(i => { const p = PRODS.find(p => p.id === i.id); return `<tr><td>${esc(p.nombre)}</td>
    <td class="qty"><button onclick="cambiar(${i.id},-1)">−</button> ${i.cant} <button onclick="cambiar(${i.id},1)">+</button></td>
    <td>${m(p.precio * i.cant)}</td></tr>`; }).join('') || '<tr><td>Vacío</td></tr>'}</table>
  <div class="tot"><div><span>Subtotal</span><span>${m(t.sub)}</span></div>
  <div><span>Impuesto (${esc(NEG.impuesto)}%)</span><span>${m(t.imp)}</span></div>
  <div class="grande"><span>TOTAL</span><span>${m(t.total)}</span></div></div>
  <div class="row" style="margin-top:12px"><select id="pago" style="flex:1"><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option></select>
  <input id="recibido" type="number" step="0.01" min="0" placeholder="Recibido" style="width:110px"></div>
  <div class="row" style="margin-top:12px"><button class="btn verde" id="btnCobrar" style="flex:1" onclick="h(cobrar)">✅ Cobrar</button>
  <button class="btn rojo" onclick="carrito=[];pintarCarrito()">Vaciar</button></div>`;
}
let cobrando = false;
async function cobrar() {
  if (cobrando) return;
  if (!carrito.length) throw new Error('El carrito está vacío');
  cobrando = true; $('#btnCobrar').disabled = true;
  try {
    const pago = $('#pago').value;
    const v = await q(sb.rpc('registrar_venta', {
      p_caja_id: cajaSel, p_pago: pago,
      p_recibido: pago === 'Efectivo' ? Number($('#recibido').value) : null,
      p_items: carrito.map(i => ({ producto_id: i.id, cant: i.cant }))
    }));
    carrito = [];
    await vPOS();
    aviso(v.cambio > 0 ? 'Venta registrada · Cambio: ' + mt(v.cambio) : 'Venta registrada ✅');
    imprimir(v);
  } finally { cobrando = false; const b = $('#btnCobrar'); if (b) b.disabled = false; }
}
function imprimir(v) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{size:80mm auto;margin:0}
    body{font-family:monospace;font-size:12px;width:72mm;margin:0;padding:4mm}
    hr{border:0;border-top:1px dashed #000}
  </style></head><body>
  <center><b>${esc(NEG.nombre)}</b><br>Recibo #${v.numero}<br>${esc(fecha(v.fecha))}<br>Cajero: ${esc(v.cajero)}</center><hr>
  ${v.items.map(i => `${i.cant} x ${esc(i.nombre)}<br>&nbsp;&nbsp;&nbsp;${m(i.precio * i.cant)}`).join('<br>')}<hr>
  Subtotal: ${m(v.subtotal)}<br>Impuesto: ${m(v.impuesto)}<br><b>TOTAL: ${m(v.total)}</b><br>
  Pago: ${esc(v.pago)}${v.cambio ? '<br>Cambio: ' + m(v.cambio) : ''}<hr>
  <center>¡Gracias por su compra!</center></body></html>`;
  let f = document.getElementById('printFrame');
  if (!f) {
    f = document.createElement('iframe'); f.id = 'printFrame';
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
  }
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); };
  f.srcdoc = html;
}

// ============ CAJAS ============
async function vCajas() {
  const [cajas, cierres] = await Promise.all([q(sb.from('cajas').select('*').order('id')), q(sb.from('cierres').select('*').order('id', { ascending: false }).limit(30))]);
  CAJAS = cajas;
  pintar('cajas', `<h2>Cajas registradoras</h2>
  ${esAdmin() ? `<div class="card row"><input id="ncaja" placeholder="Nombre de la nueva caja" maxlength="60"><button class="btn" onclick="h(addCaja)">+ Crear caja</button></div>` : ''}
  <div class="card"><table><tr><th>Caja</th><th>Estado</th><th>Apertura</th><th>Cajero</th><th>Acción</th></tr>
  ${cajas.map(c => `<tr><td>${esc(c.nombre)}</td>
    <td><span class="badge ${c.abierta ? 'abierta' : 'cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
    <td>${c.abierta ? m(c.apertura) + ' · ' + esc(fecha(c.fecha_apertura)) : '-'}</td><td>${esc(c.cajero) || '-'}</td>
    <td>${c.abierta ? `<button class="btn rojo" onclick="h(cerrarCaja,${c.id})">Cerrar caja</button>` : `<button class="btn verde" onclick="h(abrirCaja,${c.id})">Abrir caja</button>`}
    ${!c.abierta && cajas.length > 1 && esAdmin() ? `<button class="btn gris" onclick="h(delCaja,${c.id})">🗑</button>` : ''}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Últimos cierres</h3><table><tr><th>Cierre</th><th>Caja</th><th>Cajero</th><th>Ventas</th><th>Efectivo esperado</th></tr>
  ${cierres.map(c => `<tr><td>${esc(fecha(c.fecha_cierre))}</td><td>${esc(c.caja_nombre)}</td><td>${esc(c.cajero)}</td><td>${m(+c.ventas_efectivo + +c.ventas_otros)} (${c.num_ventas})</td><td>${m(c.esperado)}</td></tr>`).join('') || '<tr><td colspan="5">Aún no hay cierres</td></tr>'}</table></div>`);
}
async function addCaja() { const n = $('#ncaja').value.trim(); if (!n) return; await q(sb.from('cajas').insert({ nombre: n })); vCajas(); }
async function delCaja(id) { if (!confirm('¿Eliminar esta caja? (sus ventas anteriores se conservan)')) return; await q(sb.from('cajas').delete().eq('id', id)); vCajas(); }
async function abrirCaja(id) {
  const nom = esAdmin() ? prompt('Nombre del cajero:', nombreCorto()) : nombreCorto(); if (!nom || !nom.trim()) return;
  const s = prompt('Monto inicial en efectivo:', '0'); if (s === null) return;
  const n = Number(s); if (!isFinite(n) || n < 0) throw new Error('Monto inválido');
  const r = await q(sb.from('cajas').update({ abierta: true, apertura: n, fecha_apertura: new Date().toISOString(), cajero: nom.trim().slice(0, 40) }).eq('id', id).eq('abierta', false).select());
  if (!r.length) throw new Error('Esa caja ya está abierta');
  cajaSel = id; vCajas();
}
async function cerrarCaja(id) {
  const r = await q(sb.rpc('resumen_caja', { p_caja_id: id }));
  if (!confirm(`CIERRE DE CAJA\n\nApertura: ${mt(r.apertura)}\nVentas efectivo: ${mt(r.ventas_efectivo)}\nVentas tarjeta/otros: ${mt(r.ventas_otros)}\nTotal ventas: ${mt(+r.ventas_efectivo + +r.ventas_otros)} (${r.num_ventas})\n\nEfectivo esperado en caja: ${mt(r.esperado)}\n\n¿Cerrar caja?`)) return;
  await q(sb.rpc('cerrar_caja', { p_caja_id: id }));
  vCajas();
}

// ============ PRODUCTOS ============
async function vProductos() {
  PRODS = await q(sb.from('productos').select('*'));
  PRODS.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  pintar('productos', `<h2>Productos</h2>
  <div class="card row"><input id="pc" placeholder="Código" maxlength="40"><input id="pn" placeholder="Nombre" maxlength="120"><input id="pp" type="number" step="0.01" min="0" placeholder="Precio"><input id="ps" type="number" min="0" placeholder="Stock">
  <button class="btn" onclick="h(addProd)">+ Agregar</button></div>
  <div class="card"><table><tr><th>Código</th><th>Nombre</th><th>Precio</th><th>Stock</th><th></th></tr>
  ${PRODS.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td>${m(p.precio)}</td><td>${p.stock}</td>
  <td><button class="btn gris" onclick="h(editProd,${p.id})">✏️</button> <button class="btn rojo" onclick="h(delProd,${p.id})">🗑</button></td></tr>`).join('') || '<tr><td colspan="5">Aún no hay productos</td></tr>'}</table></div>`);
}
function datosProd(codigo, nombre, precio, stock) {
  codigo = String(codigo).trim(); nombre = String(nombre).trim();
  const pr = Number(precio), st = Number(stock);
  if (!codigo || !nombre) throw new Error('Completa código y nombre');
  if (!isFinite(pr) || pr < 0 || String(precio).trim() === '') throw new Error('Precio inválido');
  if (!Number.isInteger(st) || st < 0 || String(stock).trim() === '') throw new Error('Stock inválido (número entero)');
  return { codigo, nombre, precio: pr, stock: st };
}
async function addProd() {
  await q(sb.from('productos').insert(datosProd($('#pc').value, $('#pn').value, $('#pp').value, $('#ps').value)));
  vProductos();
}
async function editProd(id) {
  const p = PRODS.find(p => p.id === id);
  const n = prompt('Nombre:', p.nombre); if (n === null) return;
  const pr = prompt('Precio:', p.precio); if (pr === null) return;
  const st = prompt('Stock:', p.stock); if (st === null) return;
  await q(sb.from('productos').update(datosProd(p.codigo, n, pr, st)).eq('id', id));
  vProductos();
}
async function delProd(id) { if (!confirm('¿Eliminar producto?')) return; await q(sb.from('productos').delete().eq('id', id)); vProductos(); }

// ============ VENTAS ============
async function vVentas() {
  const vs = await q(sb.from('ventas').select('id,numero,fecha,caja_nombre,cajero,pago,total').order('id', { ascending: false }).limit(200));
  pintar('ventas', `<h2>Historial de ventas</h2><div class="card"><table>
  <tr><th>#</th><th>Fecha</th><th>Caja/Cajero</th><th>Pago</th><th>Total</th><th></th></tr>
  ${vs.map(v => `<tr><td>${v.numero}</td><td>${esc(fecha(v.fecha))}</td><td>${esc(v.caja_nombre)} / ${esc(v.cajero)}</td><td>${esc(v.pago)}</td><td><b>${m(v.total)}</b></td>
  <td><button class="btn gris" onclick="h(reimprimir,${v.id})">🖨</button></td></tr>`).join('') || '<tr><td colspan="6">Aún no hay ventas</td></tr>'}</table></div>`);
}
async function reimprimir(id) {
  const [v, items] = await Promise.all([q(sb.from('ventas').select('*').eq('id', id).single()), q(sb.from('venta_items').select('nombre,precio,cant').eq('venta_id', id).order('id'))]);
  imprimir({ ...v, items });
}

// ============ CONFIGURACIÓN ============
function vConfig() {
  pintar('config', `<h2>Configuración</h2>
  <div class="card col"><h3>Mi tienda</h3>
  <label>Nombre de la tienda<input id="ct" value="${esc(NEG.nombre)}" maxlength="80"></label>
  <label>Impuesto (%)<input id="ci" type="number" step="0.01" min="0" max="100" value="${esc(NEG.impuesto)}"></label>
  <label>Símbolo de moneda<input id="cm" value="${esc(NEG.moneda)}" maxlength="4"></label>
  <button class="btn" onclick="h(saveConf)">Guardar</button></div>
  <div class="card col"><h3>Respaldo</h3>
  <p style="font-size:14px;color:var(--gris)">Descarga una copia de todos tus datos (productos, cajas, ventas y cierres).</p>
  <button class="btn gris" onclick="h(respaldo)">⬇️ Descargar respaldo</button></div>`);
}
async function saveConf() {
  const nombre = val('ct'), impuesto = Number($('#ci').value), moneda = val('cm');
  if (!nombre || !moneda) throw new Error('Completa nombre y moneda');
  if (!isFinite(impuesto) || impuesto < 0 || impuesto > 100) throw new Error('El impuesto debe estar entre 0 y 100');
  NEG = await q(sb.from('config').update({ nombre, impuesto, moneda }).eq('user_id', NEG.user_id).select().single());
  menu(); aviso('Configuración guardada');
}
// ============ USUARIOS ============
async function vUsuarios() {
  const us = await q(sb.from('miembros').select('user_id,negocio_id,usuario,rol,created_at').order('created_at'));
  pintar('usuarios', `<h2>Usuarios</h2>
  <div class="card row">
    <input id="u_nom" placeholder="Usuario" maxlength="30" autocomplete="off" autocapitalize="none">
    <input id="u_pass" type="password" placeholder="Contraseña (mín. 8)" autocomplete="new-password">
    <select id="u_rol"><option value="cajero">Cajero</option><option value="admin">Administrador</option></select>
    <button class="btn" onclick="h(addUsuario)">+ Crear usuario</button>
  </div>
  <div class="card"><table><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th></th></tr>
  ${us.map(u => {
    const yo = u.user_id === U.id, dueno = u.user_id === u.negocio_id;
    return `<tr><td>${esc(u.usuario)}${dueno ? ' <small style="color:var(--gris)">(dueño)</small>' : ''}</td>
    <td>${yo || dueno ? esc(u.rol) : `<select onchange="h(rolUsuario,'${u.user_id}',this.value)"><option value="cajero" ${u.rol === 'cajero' ? 'selected' : ''}>cajero</option><option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>admin</option></select>`}</td>
    <td>${esc(fecha(u.created_at))}</td>
    <td style="text-align:right">${yo ? '(tú)' : `<button class="btn gris" title="Cambiar contraseña" onclick="h(claveUsuario,'${u.user_id}','${esc(u.usuario)}')">🔑</button>
      ${dueno ? '' : `<button class="btn rojo" title="Eliminar" onclick="h(delUsuario,'${u.user_id}','${esc(u.usuario)}')">🗑</button>`}`}</td></tr>`;
  }).join('')}</table></div>`);
  const f = $('#u_pass'); if (f) f.onkeydown = e => { if (e.key === 'Enter') h(addUsuario); };
}
async function addUsuario() {
  const usuario = val('u_nom').toLowerCase(), clave = $('#u_pass').value, rol = $('#u_rol').value;
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('El usuario debe tener de 3 a 30 caracteres (letras, números, punto o guion, sin espacios)');
  if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  await q(sb.rpc('crear_usuario', { p_usuario: usuario, p_clave: clave, p_rol: rol }));
  aviso('Usuario "' + usuario + '" creado ✅');
  vUsuarios();
}
async function rolUsuario(id, rol) {
  try { await q(sb.rpc('cambiar_rol_usuario', { p_id: id, p_rol: rol })); aviso('Rol actualizado'); }
  finally { vUsuarios(); }
}
async function claveUsuario(id, nombre) {
  const c = prompt('Nueva contraseña para "' + nombre + '" (mínimo 8):'); if (c === null) return;
  if (c.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  await q(sb.rpc('cambiar_clave_usuario', { p_id: id, p_clave: c }));
  aviso('Contraseña de "' + nombre + '" actualizada');
}
async function delUsuario(id, nombre) {
  if (!confirm('¿Eliminar al usuario "' + nombre + '"? Ya no podrá entrar al sistema. (Sus ventas se conservan)')) return;
  await q(sb.rpc('eliminar_usuario', { p_id: id }));
  aviso('Usuario eliminado'); vUsuarios();
}

// ============ MI CUENTA ============
function vCuenta() {
  const correo = U.email && !/@usuarios\.mipos\.app$/.test(U.email) ? U.email : null;
  pintar('cuenta', `<h2>Mi cuenta</h2>
  <div class="card col"><h3>Mis datos</h3>
  <div>Usuario: <b>${esc(nombreCorto())}</b></div>
  <div>Rol: <b>${esc(PERFIL ? PERFIL.rol : 'admin')}</b></div>
  ${correo ? `<div>Correo: <b>${esc(correo)}</b></div>` : ''}
  <p style="font-size:13px;color:var(--gris)">Para entrar puedes escribir tu usuario${correo ? ' o tu correo' : ''}.</p></div>
  <div class="card col"><h3>Cambiar contraseña</h3>
  <input id="k1" type="password" placeholder="Nueva contraseña (mínimo 8)" autocomplete="new-password">
  <input id="k2" type="password" placeholder="Repetir contraseña" autocomplete="new-password">
  <button class="btn" onclick="h(cambiarClave)">Cambiar contraseña</button></div>`);
}
async function cambiarClave() {
  const p = $('#k1').value;
  if (p.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (p !== $('#k2').value) throw new Error('Las contraseñas no coinciden');
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) throw new Error(tr(error.message));
  $('#k1').value = ''; $('#k2').value = ''; aviso('Contraseña actualizada');
}
async function respaldo() {
  const [config, productos, cajas, ventas, venta_items, cierres] = await Promise.all(
    [q(sb.from('config').select('*')), todo('productos'), todo('cajas'), todo('ventas'), todo('venta_items'), todo('cierres')]);
  const blob = new Blob([JSON.stringify({ generado: new Date().toISOString(), config, productos, cajas, ventas, venta_items, cierres }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'respaldo-pos-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  aviso('Respaldo descargado');
}

// ============ ARRANQUE ============
(async () => {
  if (!configurado) return pantallaConfig();
  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') recuperando = true;
    setTimeout(() => {
      if (ev === 'PASSWORD_RECOVERY') pantallaAuth('nueva');
      else if (ev === 'SIGNED_OUT' && enSistema) { U = null; pantallaAuth('login'); }
    }, 0);
  });
  try {
    const { data } = await sb.auth.getSession();
    if (recuperando) return;
    if (data.session) await iniciar(data.session.user); else pantallaAuth('login');
  } catch (e) { pantallaAuth('login'); aviso(tr(e.message), true); }
})();