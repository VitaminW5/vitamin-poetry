const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const app = $('#app');
let site = null, poems = [], session = {authenticated:false,csrf:null};

const collections = {
  weiyan:{name:'微言小谈',kind:'古体诗词',desc:'格律、旧典、长夜与偶然落下的几行。'},
  luanzhang:{name:'乱章杂句',kind:'歌词',desc:'借曲成句，也收下尚未真正唱出的告别。'},
  weicheng:{name:'未成曲调',kind:'现代诗',desc:'节奏仍在，但不必被旋律规定去向。'}
};

async function api(url, opts={}){
  const method=(opts.method||'GET').toUpperCase();
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(!['GET','HEAD','OPTIONS'].includes(method) && session.csrf) headers['X-CSRF-Token']=session.csrf;
  const res = await fetch(url,{...opts,method,headers,credentials:'same-origin'});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}
function route(path){ history.pushState({},'',path); render(); window.scrollTo({top:0,behavior:'instant'}); }
document.addEventListener('click',e=>{const a=e.target.closest('a[data-link]');if(!a)return;e.preventDefault();route(a.getAttribute('href'));});
window.addEventListener('popstate',render);

function nav(active=''){
  return `<nav class="site-nav"><div class="wrap nav-inner"><a class="brand" data-link href="/">维生素</a><div class="navlinks">
    <a data-link class="${active==='weiyan'?'active':''}" href="/collection/weiyan">微言小谈</a>
    <a data-link class="${active==='luanzhang'?'active':''}" href="/collection/luanzhang">乱章杂句</a>
    <a data-link class="${active==='weicheng'?'active':''}" href="/collection/weicheng">未成曲调</a>
    <a data-link class="${active==='about'?'active':''}" href="/about">关于</a>
  </div><span class="nav-more">97 PIECES</span></div></nav>`;
}
function footer(){return `<footer class="wrap footer"><span>© 维生素</span><span>诗 / 词 / 未成曲调</span></footer>`}
function layout(content,active=''){app.innerHTML=`<div class="shell">${nav(active)}${content}${footer()}</div>`}
function posterCard(p){return `<a data-link class="poster-card" href="/poem/${p.id}" aria-label="${esc(p.title)}"><img loading="lazy" src="${p.poster}" alt="${esc(p.title)} 海报"><span class="poster-no">${String(p.id).padStart(2,'0')}</span><span class="poster-meta"><b>${esc(p.title)}</b><small>${esc(p.collection)} · ${esc(p.kind)}</small></span></a>`}
function randomPoem(except){const pool=poems.filter(p=>p.id!==except);return pool[Math.floor(Math.random()*pool.length)]}

function home(){
  const featured=poems.filter(p=>p.featured).slice(0,8);
  const covers={weiyan:poems.find(p=>p.collectionSlug==='weiyan')?.background,luanzhang:poems.find(p=>p.collectionSlug==='luanzhang')?.background,weicheng:poems.find(p=>p.collectionSlug==='weicheng')?.background};
  layout(`<section class="hero"><div class="hero-bg" style="background-image:url('${poems.find(p=>p.id===90)?.background || poems[0]?.background}')"></div><div class="wrap hero-content"><div class="kicker">PRIVATE ANTHOLOGY · SINCE 2021</div><h1>维生素</h1><div class="latin">VITAMIN</div><div class="hero-quote">“只有海风，聆听我的心声。”</div><div class="hero-actions"><a data-link class="btn primary" href="/collection/weiyan">开始翻阅</a><a data-random class="btn" href="#">随便一篇</a></div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>三册</h2><span>39 / 9 / 49</span></div><div class="books">
  ${Object.entries(collections).map(([slug,c],i)=>`<a data-link class="book" style="--cover:url('${covers[slug]}')" href="/collection/${slug}"><div class="num">0${i+1}</div><div><h3>${c.name}</h3><p>${c.kind} · ${poems.filter(p=>p.collectionSlug===slug).length} 篇。${c.desc}</p></div><div class="enter">进入此册 →</div></a>`).join('')}
  </div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>散页</h2><span>SELECTED</span></div><div class="poster-grid">${featured.map(posterCard).join('')}</div></div></section>`);
  $('[data-random]').onclick=e=>{e.preventDefault();route('/poem/'+randomPoem().id)};
}
function collectionPage(slug){
  const c=collections[slug]; if(!c) return notFound();
  let list=poems.filter(p=>p.collectionSlug===slug);
  const hero=list[Math.min(2,list.length-1)]?.background;
  layout(`<header class="page-hero"><div class="hero-bg" style="background-image:url('${hero}')"></div><div class="wrap"><div class="kicker">第 ${slug==='weiyan'?'一':slug==='luanzhang'?'二':'三'} 册 · ${c.kind}</div><h1>${c.name}</h1><p>${c.desc}</p></div></header><main class="section"><div class="wrap"><div class="catalog-tools"><input id="catalogSearch" class="search" placeholder="在此册中搜索……"><span class="count">${list.length} 篇</span></div><div id="catalogGrid" class="catalog-grid">${list.map(posterCard).join('')}</div></div></main>`,slug);
  $('#catalogSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();const filtered=list.filter(p=>p.title.toLowerCase().includes(q)||p.content.toLowerCase().includes(q));$('#catalogGrid').innerHTML=filtered.length?filtered.map(posterCard).join(''):`<div class="empty">没有找到对应作品。</div>`;$('.count').textContent=`${filtered.length} 篇`;});
}
function poemPage(id){
  const p=poems.find(x=>x.id===Number(id)); if(!p)return notFound();
  const same=poems.filter(x=>x.collectionSlug===p.collectionSlug), idx=same.findIndex(x=>x.id===p.id), prev=same[idx-1], next=same[idx+1];
  document.title=`${p.title} · 维生素`;
  layout(`<header class="poem-hero"><div class="hero-bg" style="background-image:url('${p.background}')"></div><div class="wrap poem-heading"><div class="crumb"><a data-link href="/collection/${p.collectionSlug}">${p.collection}</a> / ${String(p.id).padStart(2,'0')}</div><h1>${esc(p.title)}</h1><div class="meta">${esc(p.kind)} · ${esc(p.dateLabel)}</div></div></header>
  <main class="wrap reader-wrap"><article><div class="poem-body ${p.collectionSlug==='weiyan'?'classic':p.collectionSlug==='luanzhang'?'song':''}">${esc(p.content)}</div><div class="author-sign">— 维生素</div><div class="poem-nav"><span>${prev?`<a data-link href="/poem/${prev.id}">← ${esc(prev.title)}</a>`:''}</span><span>${next?`<a data-link href="/poem/${next.id}">${esc(next.title)} →</a>`:''}</span></div><div class="random-line"><a class="random-link" href="#" data-random>随便翻到另一篇</a></div></article><aside class="poem-aside"><img class="aside-poster" src="${p.poster}" alt="${esc(p.title)} 海报"><div class="aside-label">${String(p.id).padStart(2,'0')} / ${esc(p.collection)}</div></aside></main>`,p.collectionSlug);
  $('[data-random]').onclick=e=>{e.preventDefault();route('/poem/'+randomPoem(p.id).id)};
}
function about(){layout(`<main class="wrap about"><div class="kicker">ABOUT</div><h1>维生素</h1><p>从 2021 年起，断断续续写了一些东西。<br><br>有些成了古体诗词，有些写成歌词，也有一些不愿被谱成曲。于是把它们收在这里。日期大多已经记不清，便不替过去虚构一个准确的时刻。</p><div class="three">微言小谈 · 古体诗词 · 39 篇<br>乱章杂句 · 歌词 · 9 篇<br>未成曲调 · 现代诗 · 49 篇<br><br>全部作品公开阅读。作者署名：维生素。</div></main>`,'about')}
function notFound(){layout(`<main class="wrap about"><div class="kicker">404</div><h1>这一页没有诗。</h1><p><a data-link href="/">返回首页。</a></p></main>`)}

async function loginPage(){
  session=await api('/api/session');
  if(session.authenticated) return studioPage();
  app.innerHTML=`<div class="shell">${nav()}<main class="login-wrap"><form class="login-card" id="loginForm"><div class="kicker">PRIVATE STUDIO</div><h1>后台登录</h1><p>此入口仅用于作者管理作品。</p><div id="loginError"></div><div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required autofocus></div><button class="btn primary">进入 Studio</button></form></main>${footer()}</div>`;
  $('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').innerHTML='';const btn=e.target.querySelector('button');btn.disabled=true;try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({password:e.target.password.value})});session={authenticated:true,csrf:result.csrf||null};studioPage()}catch(err){$('#loginError').innerHTML=`<div class="notice">${esc(err.message)}</div>`;btn.disabled=false}};
}

async function studioPage(){
  try{session=await api('/api/session');if(!session.authenticated)return loginPage();}catch(_){return loginPage()}
  let adminPoems=await api('/api/admin/poems'); let selected=adminPoems[0]?.id; let filter='all';
  const renderStudio=()=>{
    const filtered=adminPoems.filter(p=>filter==='all'||p.collectionSlug===filter);
    const p=adminPoems.find(x=>x.id===selected);
    app.innerHTML=`<div class="studio"><aside class="studio-side"><div class="studio-brand">维生素 · Studio</div><div class="studio-menu"><button class="${filter==='all'?'active':''}" data-filter="all">全部作品</button><button class="${filter==='weiyan'?'active':''}" data-filter="weiyan">微言小谈</button><button class="${filter==='luanzhang'?'active':''}" data-filter="luanzhang">乱章杂句</button><button class="${filter==='weicheng'?'active':''}" data-filter="weicheng">未成曲调</button><a data-link href="/">查看前台 ↗</a><button id="logout">退出登录</button></div></aside><main class="studio-main"><div class="studio-top"><h1>作品管理</h1><button id="newPoem" class="btn primary">＋ 新建作品</button></div><div class="stats"><div class="stat"><b>${adminPoems.length}</b><span>全部</span></div><div class="stat"><b>${adminPoems.filter(x=>x.collectionSlug==='weiyan').length}</b><span>微言小谈</span></div><div class="stat"><b>${adminPoems.filter(x=>x.collectionSlug==='luanzhang').length}</b><span>乱章杂句</span></div><div class="stat"><b>${adminPoems.filter(x=>x.collectionSlug==='weicheng').length}</b><span>未成曲调</span></div></div><div class="studio-grid"><section class="panel"><div class="panel-head"><input id="adminSearch" class="search" placeholder="搜索作品"><span class="count">${filtered.length}</span></div><div class="admin-list" id="adminList">${adminRows(filtered)}</div></section><section class="panel">${p?editor(p):'<div class="admin-empty">选择一篇作品开始编辑。</div>'}</section></div></main></div>`;
    wireStudio();
  };
  const adminRows=list=>list.map(p=>`<div class="admin-row ${p.id===selected?'selected':''}" data-id="${p.id}"><span class="id">${String(p.id).padStart(2,'0')}</span><span><b>${esc(p.title)}</b><small>${esc(p.collection)} · ${esc(p.dateLabel)}</small></span><span class="pill ${p.published?'live':''}">${p.published?'公开':'草稿'}</span></div>`).join('');
  const editor=p=>`<form id="editor" class="editor"><div class="row-fields"><div class="field"><label>标题</label><input name="title" value="${esc(p.title)}" required></div><div class="field"><label>文集</label><select name="collection">${['微言小谈','乱章杂句','未成曲调'].map(c=>`<option ${p.collection===c?'selected':''}>${c}</option>`).join('')}</select></div></div><div class="field"><label>时间标签</label><input name="dateLabel" value="${esc(p.dateLabel)}"></div><div class="field"><label>正文</label><textarea name="content" required>${esc(p.content)}</textarea></div><div class="row-fields"><div class="field"><label>海报路径</label><input name="poster" value="${esc(p.poster||'')}"></div><div class="field"><label>背景路径</label><input name="background" value="${esc(p.background||'')}"></div></div><div class="checkline"><label><input name="published" type="checkbox" ${p.published?'checked':''}> 已公开</label><label><input name="featured" type="checkbox" ${p.featured?'checked':''}> 首页推荐</label></div><div class="editor-actions"><a data-link class="btn" href="/poem/${p.id}">查看前台</a><button class="btn primary">保存修改</button></div></form>`;
  function wireStudio(){
    $$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;renderStudio()});
    $$('.admin-row').forEach(r=>r.onclick=()=>{selected=Number(r.dataset.id);renderStudio()});
    $('#adminSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();const base=adminPoems.filter(p=>filter==='all'||p.collectionSlug===filter);const list=base.filter(p=>p.title.toLowerCase().includes(q)||p.content.toLowerCase().includes(q));$('#adminList').innerHTML=adminRows(list);$$('.admin-row').forEach(r=>r.onclick=()=>{selected=Number(r.dataset.id);renderStudio()});$('.panel-head .count').textContent=list.length};
    $('#logout').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'});session={authenticated:false,csrf:null};route('/')};
    $('#newPoem').onclick=()=>newPoemDialog();
    const form=$('#editor'); if(form) form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);const payload={title:f.get('title'),collection:f.get('collection'),dateLabel:f.get('dateLabel'),content:f.get('content'),poster:f.get('poster'),background:f.get('background'),published:form.published.checked,featured:form.featured.checked};try{const updated=await api('/api/admin/poems/'+selected,{method:'PUT',body:JSON.stringify(payload)});adminPoems=adminPoems.map(p=>p.id===selected?updated:p);poems=await api('/api/poems');toast('已保存');renderStudio()}catch(err){toast(err.message)}};
  }
  async function newPoemDialog(){
    const title=prompt('新作品标题'); if(!title)return; const content=prompt('先输入一小段正文（之后可在编辑器继续修改）'); if(!content)return;
    try{const created=await api('/api/admin/poems',{method:'POST',body:JSON.stringify({title,content,collection:'未成曲调',published:false})});adminPoems.push(created);selected=created.id;renderStudio();toast('草稿已创建')}catch(err){toast(err.message)}
  }
  renderStudio();
}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}

async function render(){
  const path=location.pathname.replace(/\/+$/,'')||'/';
  if(path==='/studio'||path==='/studio/login') return loginPage();
  if(!site||!poems.length){try{[site,poems]=await Promise.all([api('/api/site'),api('/api/poems')])}catch(err){app.innerHTML=`<div class="login-wrap"><div class="login-card"><h1>无法读取站点数据</h1><p>${esc(err.message)}</p></div></div>`;return}}
  document.title='维生素';
  if(path==='/')return home();
  if(path==='/about')return about();
  let m=path.match(/^\/collection\/(weiyan|luanzhang|weicheng)$/);if(m)return collectionPage(m[1]);
  m=path.match(/^\/poem\/(\d+)$/);if(m)return poemPage(m[1]);
  return notFound();
}
render();
