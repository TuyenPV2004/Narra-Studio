const d="6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";let s=0;const p=3e3;async function m(){const o=Date.now()-s;if(o<p){const t=p-o;console.log(`[CAPTCHA] Throttle: waiting ${t}ms before next token`),await new Promise(c=>setTimeout(c,t))}s=Date.now()}async function f(e,o){let t=d,c="flowWebview";typeof e=="number"?c=e===0?"flowWebview":`flowWebview-${e}`:typeof e=="string"&&e&&(t=e);const a=o||"IMAGE_GENERATION";try{if((await window.api.getCaptchaBridgeStatus?.())?.connected)return"EXTENSION_PLACEHOLDER_"+Date.now()}catch{}await m();const w=document.getElementById(c)||document.getElementById("flowWebview");if(!w)throw new Error("WebView not found");let i="";for(let n=0;n<3;n++){if(n>0){const r=2e3*n;console.log(`[CAPTCHA] Retry #${n}, waiting ${r}ms...`),await new Promise(u=>setTimeout(u,r)),s=Date.now()}try{return await w.executeJavaScript(`
        (function() {
          return new Promise(async (resolve, reject) => {
            try {
              if (!window.grecaptcha || !window.grecaptcha.enterprise) {
                await new Promise((res, rej) => {
                  const s = document.createElement('script');
                  s.src = 'https://www.google.com/recaptcha/enterprise.js?render=${t}';
                  s.onload = res; s.onerror = rej;
                  document.head.appendChild(s);
                });
                await new Promise(r => setTimeout(r, 2000));
              }
              grecaptcha.enterprise.ready(async () => {
                try {
                  const t = await grecaptcha.enterprise.execute('${t}', {action:'${a}'});
                  resolve(t);
                } catch(e) { reject(e.message || 'execute failed'); }
              });
              setTimeout(() => reject('CAPTCHA timeout'), 15000);
            } catch(e) { reject(e.message || String(e)); }
          });
        })()
      `)}catch(r){i=r?.message||String(r),console.warn(`[CAPTCHA] Attempt ${n+1} failed:`,i)}}throw new Error(`CAPTCHA failed after 3 attempts: ${i}`)}async function h(e,o){const t=e||d,c=o||document.getElementById("flowWebview");if(c)try{await c.executeJavaScript(`
      (function() {
        if (window.__rcInjected) return;
        if (window.grecaptcha && window.grecaptcha.enterprise) { window.__rcInjected=true; return; }
        const s = document.createElement('script');
        s.src = 'https://www.google.com/recaptcha/enterprise.js?render=${t}';
        s.onload = () => { window.__rcInjected = true; };
        document.head.appendChild(s);
      })()
    `)}catch(a){console.error("Inject error:",a)}}export{f as getCaptchaToken,h as injectRecaptcha};
