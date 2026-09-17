// Chamado apenas pelo login explícito principal. Restauração de sessão e authAux não usam este módulo.
export async function registrarAcesso({sdk, db, uid}) {
  try {
    const snap = await sdk.getDoc(sdk.doc(db,'usuarios',uid));
    if (!snap.exists()) return false;
    const profile = snap.data();
    await sdk.addDoc(sdk.collection(db,'acessos'), {
      uid, role:profile.role, obraId:profile.obra_id || '', evento:'login', criadoEm:sdk.serverTimestamp(),
    });
    return true;
  } catch (_) { return false; } // Auditoria indisponível nunca impede autenticação.
}

export async function loginAuditado({signIn, registrar}, ...args) {
  const cred = await signIn(...args);
  // Não bloqueia a abertura do sistema nem repete o login se o log falhar.
  void Promise.resolve().then(()=>registrar(cred.user.uid)).catch(()=>{});
  return cred;
}

export function criarPainelAcessos({sdk,db,getRole}) {
  let generation = 0;
  return async function carregar(host) {
    if (!host) return;
    const atual = ++generation;
    host.replaceChildren();
    if (getRole() !== 'ADMIN') { host.hidden=true; return; }
    host.hidden=false;
    const doc=host.ownerDocument;
    const title=doc.createElement('h3'); title.textContent='Acessos recentes';
    const label=doc.createElement('label'); label.textContent='Perfil';
    const select=doc.createElement('select');
    for(const [value,text] of [['VISITANTE','Visitantes'],['','Todos'],['USER','Colaboradores'],['ADMIN','Administradores']]) {
      const option=doc.createElement('option'); option.value=value; option.textContent=text; select.append(option);
    }
    const refresh=doc.createElement('button'); refresh.className='btn btn-outline'; refresh.textContent='Atualizar';
    const rows=doc.createElement('div'); rows.setAttribute('role','status');
    const note=doc.createElement('p'); note.className='ep-muted'; note.textContent='Filtro aplicado aos últimos 100 acessos do sistema.';
    label.append(select); host.append(title,label,refresh,note,rows);
    let events=[], users=new Map(), obras=new Map();
    const render=()=>{
      rows.replaceChildren();
      if(getRole()!=='ADMIN') { host.hidden=true; return; }
      for(const e of events.filter(e=>!select.value || e.role===select.value)) {
        const p=doc.createElement('p');
        const role={VISITANTE:'Visitante',USER:'Colaborador',ADMIN:'Administrador'}[e.role] || e.role;
        const when=e.criadoEm?.toDate?.();
        p.textContent=`${role} · ${users.get(e.uid) || e.uid} — ${when ? when.toLocaleString('pt-BR') : 'Data indisponível'}${e.obraId ? ' · '+(obras.get(e.obraId)||e.obraId) : ''}`;
        rows.append(p);
      }
      if(!rows.childElementCount) rows.textContent='Nenhum acesso neste filtro.';
    };
    async function load() {
      if(getRole()!=='ADMIN') return;
      refresh.disabled=true; rows.textContent='Carregando acessos…';
      try {
        const snap=await sdk.getDocs(sdk.query(sdk.collection(db,'acessos'),sdk.orderBy('criadoEm','desc'),sdk.limit(100)));
        if(atual!==generation || getRole()!=='ADMIN') return;
        events=snap.docs.map(d=>d.data());
        async function resolve(collection, ids, cache) {
          await Promise.all([...new Set(ids)].filter(id=>id && !cache.has(id)).map(async id=>{
            const snap=await sdk.getDoc(sdk.doc(db,collection,id));
            cache.set(id,snap.exists() ? snap.data().nome || id : id);
          }));
        }
        await Promise.all([resolve('usuarios',events.map(e=>e.uid),users),resolve('obras',events.map(e=>e.obraId),obras)]);
        if(atual===generation) render();
      } catch(_) { rows.textContent='Não foi possível carregar os acessos. Tente atualizar.'; }
      finally { refresh.disabled=false; }
    }
    select.onchange=render; refresh.onclick=load; await load();
  };
}
