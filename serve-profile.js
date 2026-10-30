/* A roster link from RCI Serve opens the existing About page only after the
   ministry's normal authenticated schedule load. Return destinations are fixed. */
const ServeProfile = {
  key: 'rci-serve:profile-route:' + location.pathname,
  requested: null, active: false,
  init() {
    const url = new URL(location.href), id = url.searchParams.get('person');
    const incoming = url.searchParams.get('from') === 'serve-teams' && /^[1-9]\d*$/.test(id || '');
    try {
      if (url.searchParams.has('home') || url.searchParams.has('roster')) sessionStorage.removeItem(this.key);
      else if (incoming) sessionStorage.setItem(this.key,id);
      const pending = sessionStorage.getItem(this.key);
      this.requested = /^[1-9]\d*$/.test(pending || '') ? pending : null;
    } catch (_) { this.requested = incoming ? id : null; }
    if (incoming) {
      url.searchParams.delete('person'); url.searchParams.delete('from');
      history.replaceState(history.state,'',url.pathname + url.search + url.hash);
    }
  },
  apply() {
    if (!this.requested) return;
    const p = S.items.find(p => String(p.id) === this.requested && isProfile(p) && !p.gone);
    S.view = 'member'; S.arg = p ? p.id : null; S.stack = []; this.active = true;
    this.requested = null;
    try { sessionStorage.removeItem(this.key); } catch (_) {}
  },
  link() { return this.requested || this.active ? '<a class="btn" href="/?teams" data-serve-return>Back to RCI Serve Teams</a>' : ''; },
  returnToTeams() {
    try { sessionStorage.removeItem(this.key); } catch (_) {}
    this.requested = null; this.active = false;
    S.view = 'directory'; S.arg = null; S.stack = [];
    if (S.phase === 'ready') saveNav();
    location.assign('/?teams');
  },
  back() {
    if (!this.active || S.view !== 'member' || S.stack.length) return false;
    this.returnToTeams(); return true;
  }
};
ServeProfile.init();
document.addEventListener('click', e => {
  if (!e.target.closest('[data-serve-return]')) return;
  e.preventDefault(); ServeProfile.returnToTeams();
});
