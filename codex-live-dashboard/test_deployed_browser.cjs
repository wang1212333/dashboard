const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('https://bigdata-ai-docker-container2.transsion.com/static/codex-live-dashboard/index.html');
await page.waitForURL('**/login?**',{timeout:20000});
await page.locator('#password_input').fill(process.env.JUPYTER_PROBE_PASSWORD);
await page.locator('#login_submit').click();
await page.waitForURL('**/static/codex-live-dashboard/index.html',{timeout:20000});
await page.locator('#connection').filter({hasText:'真实数据 · 已连接'}).waitFor({timeout:90000});
console.log('Initial real data:',await page.locator('#receipt').innerText());
await page.locator('#start').fill('2026-09-01');await page.locator('#end').fill('2026-09-03');await page.locator('#brand').selectOption('TECNO');
await page.locator('#refresh').click();
await page.locator('#scope').filter({hasText:'2026-09-01 — 2026-09-03 · TECNO'}).waitFor({timeout:90000});
console.log('Date and brand query:',await page.locator('#receipt').innerText());
console.log('Page errors:',JSON.stringify(errors));
await page.screenshot({path:'codex-live-dashboard/jupyter-deployment-verified.png',fullPage:true});
}finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
