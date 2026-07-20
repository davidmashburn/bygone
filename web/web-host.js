"use strict";(()=>{function I(){}I.prototype={diff:function(e,t){var o,l=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},r=l.callback;typeof l=="function"&&(r=l,l={}),this.options=l;var f=this;function a(g){return r?(setTimeout(function(){r(void 0,g)},0),!0):g}e=this.castInput(e),t=this.castInput(t),e=this.removeEmpty(this.tokenize(e)),t=this.removeEmpty(this.tokenize(t));var d=t.length,s=e.length,i=1,c=d+s;l.maxEditLength&&(c=Math.min(c,l.maxEditLength));var u=(o=l.timeout)!==null&&o!==void 0?o:1/0,p=Date.now()+u,h=[{oldPos:-1,lastComponent:void 0}],v=this.extractCommon(h[0],t,e,0);if(h[0].oldPos+1>=s&&v+1>=d)return a([{value:this.join(t),count:t.length}]);var m=-1/0,w=1/0;function L(){for(var g=Math.max(m,-i);g<=Math.min(w,i);g+=2){var y=void 0,x=h[g-1],b=h[g+1];x&&(h[g-1]=void 0);var O=!1;if(b){var W=b.oldPos-g;O=b&&0<=W&&W<d}var $=x&&x.oldPos+1<s;if(!O&&!$){h[g]=void 0;continue}if(!$||O&&x.oldPos+1<b.oldPos?y=f.addToPath(b,!0,void 0,0):y=f.addToPath(x,void 0,!0,1),v=f.extractCommon(y,t,e,g),y.oldPos+1>=s&&v+1>=d)return a(X(f,y.lastComponent,t,e,f.useLongestToken));h[g]=y,y.oldPos+1>=s&&(w=Math.min(w,g-1)),v+1>=d&&(m=Math.max(m,g+1))}i++}if(r)(function g(){setTimeout(function(){if(i>c||Date.now()>p)return r();L()||g()},0)})();else for(;i<=c&&Date.now()<=p;){var D=L();if(D)return D}},addToPath:function(e,t,o,l){var r=e.lastComponent;return r&&r.added===t&&r.removed===o?{oldPos:e.oldPos+l,lastComponent:{count:r.count+1,added:t,removed:o,previousComponent:r.previousComponent}}:{oldPos:e.oldPos+l,lastComponent:{count:1,added:t,removed:o,previousComponent:r}}},extractCommon:function(e,t,o,l){for(var r=t.length,f=o.length,a=e.oldPos,d=a-l,s=0;d+1<r&&a+1<f&&this.equals(t[d+1],o[a+1]);)d++,a++,s++;return s&&(e.lastComponent={count:s,previousComponent:e.lastComponent}),e.oldPos=a,d},equals:function(e,t){return this.options.comparator?this.options.comparator(e,t):e===t||this.options.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],o=0;o<e.length;o++)e[o]&&t.push(e[o]);return t},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function X(n,e,t,o,l){for(var r=[],f;e;)r.push(e),f=e.previousComponent,delete e.previousComponent,e=f;r.reverse();for(var a=0,d=r.length,s=0,i=0;a<d;a++){var c=r[a];if(c.removed){if(c.value=n.join(o.slice(i,i+c.count)),i+=c.count,a&&r[a-1].added){var p=r[a-1];r[a-1]=r[a],r[a]=p}}else{if(!c.added&&l){var u=t.slice(s,s+c.count);u=u.map(function(v,m){var w=o[i+m];return w.length>v.length?w:v}),c.value=n.join(u)}else c.value=n.join(t.slice(s,s+c.count));s+=c.count,c.added||(i+=c.count)}}var h=r[d-1];return d>1&&typeof h.value=="string"&&(h.added||h.removed)&&n.equals("",h.value)&&(r[d-2].value+=h.value,r.pop()),r}var K=new I;function q(n,e,t){return K.diff(n,e,t)}var z=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,B=/\S/,R=new I;R.equals=function(n,e){return this.options.ignoreCase&&(n=n.toLowerCase(),e=e.toLowerCase()),n===e||this.options.ignoreWhitespace&&!B.test(n)&&!B.test(e)};R.tokenize=function(n){for(var e=n.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),t=0;t<e.length-1;t++)!e[t+1]&&e[t+2]&&z.test(e[t])&&z.test(e[t+2])&&(e[t]+=e[t+2],e.splice(t+1,2),t--);return e};function G(n,e,t){return R.diff(n,e,t)}var j=new I;j.tokenize=function(n){this.options.stripTrailingCr&&(n=n.replace(/\r\n/g,`
`));var e=[],t=n.split(/(\n|\r\n)/);t[t.length-1]||t.pop();for(var o=0;o<t.length;o++){var l=t[o];o%2&&!this.options.newlineIsToken?e[e.length-1]+=l:(this.options.ignoreWhitespace&&(l=l.trim()),e.push(l))}return e};var _=new I;_.tokenize=function(n){return n.split(/(\S.+?[.!?])(?=\s+|$)/)};var Z=new I;Z.tokenize=function(n){return n.split(/([{}:;,]|\s+)/)};function C(n){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?C=function(e){return typeof e}:C=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},C(n)}var Q=Object.prototype.toString,E=new I;E.useLongestToken=!0;E.tokenize=j.tokenize;E.castInput=function(n){var e=this.options,t=e.undefinedReplacement,o=e.stringifyReplacer,l=o===void 0?function(r,f){return typeof f>"u"?t:f}:o;return typeof n=="string"?n:JSON.stringify(M(n,null,null,l),l,"  ")};E.equals=function(n,e){return I.prototype.equals.call(E,n.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function M(n,e,t,o,l){e=e||[],t=t||[],o&&(n=o(l,n));var r;for(r=0;r<e.length;r+=1)if(e[r]===n)return t[r];var f;if(Q.call(n)==="[object Array]"){for(e.push(n),f=new Array(n.length),t.push(f),r=0;r<n.length;r+=1)f[r]=M(n[r],e,t,o,l);return e.pop(),t.pop(),f}if(n&&n.toJSON&&(n=n.toJSON()),C(n)==="object"&&n!==null){e.push(n),f={},t.push(f);var a=[],d;for(d in n)n.hasOwnProperty(d)&&a.push(d);for(a.sort(),r=0;r<a.length;r+=1)d=a[r],f[d]=M(n[d],e,t,o,d);e.pop(),t.pop()}else f=n;return f}var T=new I;T.tokenize=function(n){return n.slice()};T.join=T.removeEmpty=function(n){return n};function J(n,e,t){return T.diff(n,e,t)}var ee=500,U=se("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",ee);function N(n,e){let t=V(n),o=V(e),l=J(t,o),r=[],f=[],a=[],d=[],s=1,i=1;for(let u=0;u<l.length;u++){let p=l[u],h=p.removed?p.value:[],v=p.added?p.value:[];if(!p.added&&!p.removed){for(let m of p.value)f.push(S("context",m,s)),a.push(S("context",m,i)),r.push(A(F("context",m,s++),F("context",m,i++)));continue}if(p.removed&&u+1<l.length&&l[u+1].added){let m=l[u+1],w=f.length,L=a.length,D=ne(h,m.value);for(let{left:g,right:y}of D){let x,b;g!==void 0&&(x=S("removed",g,s),f.push(x)),y!==void 0&&(b=S("added",y,i),a.push(b)),x&&b&&ie(x,b),r.push(A(g===void 0?H():F("removed",g,s++),y===void 0?H():F("added",y,i++)))}d.push(P("replace",w,f.length,L,a.length)),u++;continue}if(p.removed){let m=f.length,w=a.length;for(let L of h)f.push(S("removed",L,s)),r.push(A(F("removed",L,s++),H()));d.push(P("delete",m,f.length,w,a.length));continue}if(p.added){let m=f.length,w=a.length;for(let L of v)a.push(S("added",L,i)),r.push(A(H(),F("added",L,i++)));d.push(P("insert",m,f.length,w,a.length))}}let c=r.some(u=>u.left.kind!=="context"||u.right.kind!=="context");return{rows:r,leftLines:f,rightLines:a,blocks:d,hasChanges:c}}function V(n){if(n.length===0)return[];let e=n.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function ne(n,e){if(n.length*e.length>1e4)return te(n,e);let o=0,l=.45,r=Array.from({length:n.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),f=Array.from({length:n.length+1},()=>new Array(e.length+1).fill(null));r[0][0]=0;for(let i=1;i<=n.length;i++)r[i][0]=r[i-1][0]+o,f[i][0]="left";for(let i=1;i<=e.length;i++)r[0][i]=r[0][i-1]+o,f[0][i]="right";for(let i=1;i<=n.length;i++)for(let c=1;c<=e.length;c++){let u=re(n[i-1],e[c-1]),h=[{move:"match",score:u>l?r[i-1][c-1]+Math.pow(u-l,2):Number.NEGATIVE_INFINITY},{move:"left",score:r[i-1][c]+o},{move:"right",score:r[i][c-1]+o}].reduce((v,m)=>m.score>v.score?m:v);r[i][c]=h.score,f[i][c]=h.move}let a=[],d=n.length,s=e.length;for(;d>0||s>0;){let i=f[d][s];i==="match"?a.push({left:n[--d],right:e[--s]}):i==="left"?a.push({left:n[--d]}):a.push({right:e[--s]})}return a.reverse()}function te(n,e){let t=Math.max(n.length,e.length);return Array.from({length:t},(o,l)=>({left:n[l],right:e[l]}))}function re(n,e){let t=n.length+e.length;return t===0?1:2*q(n,e).filter(l=>!l.added&&!l.removed).reduce((l,r)=>l+r.value.length,0)/t}function ie(n,e){if(n.content.length>U||e.content.length>U)return;let{leftSegments:t,rightSegments:o,hasInlineChanges:l}=oe(n.content,e.content);l&&(n.segments=t,e.segments=o)}function oe(n,e){let t=G(n,e),o=[],l=[],r=!1;for(let f of t){let a=f.value;if(!f.added&&!f.removed){let s={kind:"context",text:a,emphasis:!1};o.push(s),l.push(s);continue}let d=/[^\s]/.test(a);r=r||d,f.removed&&o.push({kind:"removed",text:a,emphasis:d}),f.added&&l.push({kind:"added",text:a,emphasis:d})}return{leftSegments:o,rightSegments:l,hasInlineChanges:r}}function H(){return{kind:"placeholder",content:"",lineNumber:null}}function F(n,e,t){return{kind:n,content:e,lineNumber:t}}function S(n,e,t){return{kind:n,content:e,lineNumber:t}}function A(n,e){return{left:n,right:e}}function P(n,e,t,o,l){return{kind:n,leftStart:e,leftEnd:t,rightStart:o,rightEnd:l}}function se(n,e){let t=typeof process<"u"?process.env?.[n]:void 0,o=Number.parseInt(t??"",10);return Number.isFinite(o)&&o>0?o:e}function Y(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
const fs = require('fs');
const path = require('path');

/**
 * A simple utility class for file operations
 */
class FileProcessor {
    constructor(directory = './') {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
    }

    // Method to read files from directory
    readFiles() {
        try {
            const files = fs.readdirSync(this.directory);
            this.files = files.filter(file => file.endsWith('.js'));
            console.log(\`Found \${this.files.length} JavaScript files\`);
        } catch (error) {
            console.error('Error reading directory:', error);
        }
    }

    // Process each file
    processFiles() {
        this.files.forEach(file => {
            try {
                const filePath = path.join(this.directory, file);
                fs.readFileSync(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Processed: \${file}\`);
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
            }
        });
    }

    // Get processing results
    getResults() {
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory
        };
    }
}

// Usage example
const processor = new FileProcessor('./src');
processor.readFiles();
processor.processFiles();
const results = processor.getResults();
console.log('Results:', results);

module.exports = FileProcessor;
`,rightContent:`// Test File 2 - Modified JavaScript Code
const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * An enhanced utility class for file operations
 * Added more features and error handling
 */
class FileProcessor {
    constructor(directory = './', options = {}) {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
        this.options = { recursive: false, ...options };
        this.startTime = Date.now();
    }

    // Enhanced method to read files from directory
    readFiles() {
        try {
            const items = fs.readdirSync(this.directory);
            this.files = items.filter(item => {
                const itemPath = path.join(this.directory, item);
                const stat = fs.statSync(itemPath);
                return stat.isFile() && item.endsWith('.js');
            });
            console.log(\`Found \${this.files.length} JavaScript files in \${this.directory}\`);
        } catch (error) {
            throw new Error(\`Failed to read directory \${this.directory}: \${error.message}\`);
        }
    }

    // Enhanced file processing with async support
    async processFiles() {
        const promises = this.files.map(async (file) => {
            try {
                const filePath = path.join(this.directory, file);
                const content = await util.promisify(fs.readFile)(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Successfully processed: \${file}\`);
                return { file, content };
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
                return { file, error: error.message };
            }
        });

        const results = await Promise.all(promises);
        return results.filter(result => !result.error);
    }

    // Get enhanced processing results
    getResults() {
        const duration = Date.now() - this.startTime;
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory,
            duration: \`\${duration}ms\`,
            options: this.options
        };
    }

    // New method to clean up files
    cleanUp() {
        console.log('Cleaning up resources...');
        this.files = [];
        this.processedCount = 0;
    }
}

// Enhanced usage example
async function main() {
    const processor = new FileProcessor('./src', { recursive: true });
    processor.readFiles();
    await processor.processFiles();
    const results = processor.getResults();
    console.log('Processing complete:', results);
    processor.cleanUp();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = FileProcessor;
`}}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(s){o(s)}},window.addEventListener("DOMContentLoaded",()=>{l(),d("Browser host ready.")});function t(s){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:s}))}async function o(s){if(!(!s||typeof s!="object")){if(s.type==="ready"){new URLSearchParams(window.location.search).get("demo")==="1"&&r();return}s.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=s.leftContent,e.right.content=s.rightContent,t({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:N(e.left.content,e.right.content),history:null}))}}function l(){let s=document.getElementById("web-compare-test"),i=document.getElementById("web-open-diff"),c=document.getElementById("web-open-diff3"),u=document.getElementById("web-diff-input"),p=document.getElementById("web-diff3-input");s?.addEventListener("click",()=>{r()}),i?.addEventListener("click",()=>{u.value="",u.click()}),c?.addEventListener("click",()=>{p.value="",p.click()}),u?.addEventListener("change",async()=>{let h=Array.from(u.files||[]);if(h.length!==2){d("Select exactly 2 files for a diff.");return}await f(h)}),p?.addEventListener("change",async()=>{let h=Array.from(p.files||[]);if(h.length<1){d("Select one or more files.");return}await a(h)})}function r(){let s=Y();e.mode="diff",e.comparisonId+=1,e.left={name:s.leftFileName,content:s.leftContent},e.right={name:s.rightFileName,content:s.rightContent},d("Loaded sample diff."),t({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:N(e.left.content,e.right.content),history:null})}async function f(s){let[i,c]=s,[u,p]=await Promise.all([i.text(),c.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:i.name,content:u},e.right={name:c.name,content:p},d(`Loaded ${i.name} and ${c.name}.`),t({type:"showDiff",file1:i.name,file2:c.name,comparisonId:`web-${e.comparisonId}`,leftContent:u,rightContent:p,diffModel:N(u,p),history:null})}async function a(s){let i=await Promise.all(s.map(async(c,u)=>{let p=await c.text();return{id:`web-panel-${u}`,label:c.name,content:p,savedContent:p,dirty:!1,editable:!0}}));e.mode="multi-diff",d(`Loaded ${i.length}-panel diff for ${i.map(c=>c.label).join(", ")}.`),t({type:"showMultiDiff",panels:i,pairs:i.slice(0,-1).map((c,u)=>({leftIndex:u,rightIndex:u+1,diffModel:N(c.content,i[u+1].content)}))})}function d(s){let i=document.getElementById("web-status");i&&(i.textContent=s)}})();})();
//# sourceMappingURL=web-host.js.map
