export type ThemePreference='light'|'dark'|'system';
type ResolvedTheme=Exclude<ThemePreference,'system'>;

// The account setting is the source of truth; this cache only lets the first
// paint (and the login page) match the last theme chosen on this device.
const STORAGE_KEY='worth-split-theme';
const THEME_COLORS:Record<ResolvedTheme,string>={light:'#F1F1EE',dark:'#09090A'};

let currentPreference:ThemePreference='system';

function darkQuery(){return typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):null}

function readCachedPreference():ThemePreference{
  try{
    const stored=window.localStorage.getItem(STORAGE_KEY);
    return stored==='light'||stored==='dark'?stored:'system';
  }catch{return 'system'}
}

function resolveTheme(preference:ThemePreference):ResolvedTheme{
  if(preference!=='system')return preference;
  return darkQuery()?.matches?'dark':'light';
}

export function applyTheme(preference:ThemePreference){
  currentPreference=preference;
  const root=document.documentElement;
  const resolved=resolveTheme(preference);
  root.dataset.theme=resolved;
  root.style.colorScheme=resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',THEME_COLORS[resolved]);
  try{
    if(preference==='system')window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY,preference);
  }catch{
    // Storage can be unavailable (private mode); the theme still applies.
  }
}

/** Applies the cached theme before React renders and follows system changes. */
export function installTheme(){
  applyTheme(readCachedPreference());
  const query=darkQuery();
  const follow=()=>{if(currentPreference==='system')applyTheme('system')};
  if(typeof query?.addEventListener==='function')query.addEventListener('change',follow);
  else query?.addListener(follow);
}
