// Capture the real development app, optionally exercising its existing controls.
// electron capture-desktop.cjs <output.png> <action> <Bygone arguments...>
const { app, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [outputArg, action, ...args] = process.argv.slice(2);
const root = path.resolve(__dirname, '../..');
const output = path.resolve(outputArg);
const cwdIndex = args.indexOf('-C');
if (cwdIndex >= 0) { process.chdir(args[cwdIndex + 1]); args.splice(cwdIndex, 2); }
app.setPath('userData', fs.mkdtempSync('/tmp/bygone-walkthrough-capture-'));
process.argv = [process.argv[0], path.join(root, 'out/standalone-main.js'), '--window-width', '1440', '--window-height', '900', ...args];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Capture timed out'); app.exit(1); }, 60000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      await delay(3500);
      if (action === 'find') {
        const find = items => items.find(i => i.label === 'Search Comparison…') || items.flatMap(i => i.submenu ? [find(i.submenu.items)] : []).find(Boolean);
        const item = find(Menu.getApplicationMenu().items);
        if (!item) throw new Error('Search menu missing');
        item.click();
        await delay(500);
        await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('.visible-search-input'); if (!el) throw new Error('Search input missing'); el.value = 'publish'; el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      } else if (action === 'fit') {
        await win.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-multi-visible-count]'); if (!el) throw new Error('Density control missing'); el.value = 'fit'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
      } else if (action === 'older') {
        await win.webContents.executeJavaScript(`document.querySelector('#history-back').click()`);
      } else if (action === 'author') {
        await win.webContents.executeJavaScript(`document.querySelector('[data-workspace-mode="historical"]').click()`);
      }
      await delay(1500);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
      clearTimeout(deadline);
      console.log(`Wrote ${output}`);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require(path.join(root, 'out/standalone-main.js'));
