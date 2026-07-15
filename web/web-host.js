"use strict";(()=>{function b(){}b.prototype={diff:function(e,t){var s,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},i=a.callback;typeof a=="function"&&(i=a,a={}),this.options=a;var l=this;function o(g){return i?(setTimeout(function(){i(void 0,g)},0),!0):g}e=this.castInput(e),t=this.castInput(t),e=this.removeEmpty(this.tokenize(e)),t=this.removeEmpty(this.tokenize(t));var f=t.length,r=e.length,d=1,u=f+r;a.maxEditLength&&(u=Math.min(u,a.maxEditLength));var c=(s=a.timeout)!==null&&s!==void 0?s:1/0,p=Date.now()+c,h=[{oldPos:-1,lastComponent:void 0}],x=this.extractCommon(h[0],t,e,0);if(h[0].oldPos+1>=r&&x+1>=f)return o([{value:this.join(t),count:t.length}]);var m=-1/0,v=1/0;function L(){for(var g=Math.max(m,-d);g<=Math.min(v,d);g+=2){var w=void 0,y=h[g-1],E=h[g+1];y&&(h[g-1]=void 0);var M=!1;if(E){var W=E.oldPos-g;M=E&&0<=W&&W<f}var $=y&&y.oldPos+1<r;if(!M&&!$){h[g]=void 0;continue}if(!$||M&&y.oldPos+1<E.oldPos?w=l.addToPath(E,!0,void 0,0):w=l.addToPath(y,void 0,!0,1),x=l.extractCommon(w,t,e,g),w.oldPos+1>=r&&x+1>=f)return o(X(l,w.lastComponent,t,e,l.useLongestToken));h[g]=w,w.oldPos+1>=r&&(v=Math.min(v,g-1)),x+1>=f&&(m=Math.max(m,g+1))}d++}if(i)(function g(){setTimeout(function(){if(d>u||Date.now()>p)return i();L()||g()},0)})();else for(;d<=u&&Date.now()<=p;){var S=L();if(S)return S}},addToPath:function(e,t,s,a){var i=e.lastComponent;return i&&i.added===t&&i.removed===s?{oldPos:e.oldPos+a,lastComponent:{count:i.count+1,added:t,removed:s,previousComponent:i.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:t,removed:s,previousComponent:i}}},extractCommon:function(e,t,s,a){for(var i=t.length,l=s.length,o=e.oldPos,f=o-a,r=0;f+1<i&&o+1<l&&this.equals(t[f+1],s[o+1]);)f++,o++,r++;return r&&(e.lastComponent={count:r,previousComponent:e.lastComponent}),e.oldPos=o,f},equals:function(e,t){return this.options.comparator?this.options.comparator(e,t):e===t||this.options.ignoreCase&&e.toLowerCase()===t.toLowerCase()},removeEmpty:function(e){for(var t=[],s=0;s<e.length;s++)e[s]&&t.push(e[s]);return t},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function X(n,e,t,s,a){for(var i=[],l;e;)i.push(e),l=e.previousComponent,delete e.previousComponent,e=l;i.reverse();for(var o=0,f=i.length,r=0,d=0;o<f;o++){var u=i[o];if(u.removed){if(u.value=n.join(s.slice(d,d+u.count)),d+=u.count,o&&i[o-1].added){var p=i[o-1];i[o-1]=i[o],i[o]=p}}else{if(!u.added&&a){var c=t.slice(r,r+u.count);c=c.map(function(x,m){var v=s[d+m];return v.length>x.length?v:x}),u.value=n.join(c)}else u.value=n.join(t.slice(r,r+u.count));r+=u.count,u.added||(d+=u.count)}}var h=i[f-1];return f>1&&typeof h.value=="string"&&(h.added||h.removed)&&n.equals("",h.value)&&(i[f-2].value+=h.value,i.pop()),i}var te=new b;var z=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,B=/\S/,P=new b;P.equals=function(n,e){return this.options.ignoreCase&&(n=n.toLowerCase(),e=e.toLowerCase()),n===e||this.options.ignoreWhitespace&&!B.test(n)&&!B.test(e)};P.tokenize=function(n){for(var e=n.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),t=0;t<e.length-1;t++)!e[t+1]&&e[t+2]&&z.test(e[t])&&z.test(e[t+2])&&(e[t]+=e[t+2],e.splice(t+1,2),t--);return e};function q(n,e,t){return P.diff(n,e,t)}var G=new b;G.tokenize=function(n){this.options.stripTrailingCr&&(n=n.replace(/\r\n/g,`
`));var e=[],t=n.split(/(\n|\r\n)/);t[t.length-1]||t.pop();for(var s=0;s<t.length;s++){var a=t[s];s%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var Y=new b;Y.tokenize=function(n){return n.split(/(\S.+?[.!?])(?=\s+|$)/)};var K=new b;K.tokenize=function(n){return n.split(/([{}:;,]|\s+)/)};function C(n){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?C=function(e){return typeof e}:C=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},C(n)}var Z=Object.prototype.toString,N=new b;N.useLongestToken=!0;N.tokenize=G.tokenize;N.castInput=function(n){var e=this.options,t=e.undefinedReplacement,s=e.stringifyReplacer,a=s===void 0?function(i,l){return typeof l>"u"?t:l}:s;return typeof n=="string"?n:JSON.stringify(A(n,null,null,a),a,"  ")};N.equals=function(n,e){return b.prototype.equals.call(N,n.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function A(n,e,t,s,a){e=e||[],t=t||[],s&&(n=s(a,n));var i;for(i=0;i<e.length;i+=1)if(e[i]===n)return t[i];var l;if(Z.call(n)==="[object Array]"){for(e.push(n),l=new Array(n.length),t.push(l),i=0;i<n.length;i+=1)l[i]=A(n[i],e,t,s,a);return e.pop(),t.pop(),l}if(n&&n.toJSON&&(n=n.toJSON()),C(n)==="object"&&n!==null){e.push(n),l={},t.push(l);var o=[],f;for(f in n)n.hasOwnProperty(f)&&o.push(f);for(o.sort(),i=0;i<o.length;i+=1)f=o[i],l[f]=A(n[f],e,t,s,f);e.pop(),t.pop()}else l=n;return l}var H=new b;H.tokenize=function(n){return n.slice()};H.join=H.removeEmpty=function(n){return n};function j(n,e,t){return H.diff(n,e,t)}var k=500,J=ne("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",k);function D(n,e){let t=U(n),s=U(e),a=j(t,s),i=[],l=[],o=[],f=[],r=1,d=1;for(let c=0;c<a.length;c++){let p=a[c],h=p.removed?p.value:[],x=p.added?p.value:[];if(!p.added&&!p.removed){for(let m of p.value)l.push(I("context",m,r)),o.push(I("context",m,d)),i.push(O(F("context",m,r++),F("context",m,d++)));continue}if(p.removed&&c+1<a.length&&a[c+1].added){let m=a[c+1],v=Math.max(h.length,m.value.length),L=l.length,S=o.length;for(let g=0;g<v;g++){let w=h[g],y=m.value[g];w!==void 0&&l.push(I("removed",w,r)),y!==void 0&&o.push(I("added",y,d)),i.push(O(w===void 0?T():F("removed",w,r++),y===void 0?T():F("added",y,d++)))}f.push(R("replace",L,l.length,S,o.length)),_(l,o,L,l.length,S,o.length),c++;continue}if(p.removed){let m=l.length,v=o.length;for(let L of h)l.push(I("removed",L,r)),i.push(O(F("removed",L,r++),T()));f.push(R("delete",m,l.length,v,o.length));continue}if(p.added){let m=l.length,v=o.length;for(let L of x)o.push(I("added",L,d)),i.push(O(T(),F("added",L,d++)));f.push(R("insert",m,l.length,v,o.length))}}let u=i.some(c=>c.left.kind!=="context"||c.right.kind!=="context");return{rows:i,leftLines:l,rightLines:o,blocks:f,hasChanges:u}}function U(n){if(n.length===0)return[];let e=n.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function _(n,e,t,s,a,i){let l=Math.min(s-t,i-a);for(let o=0;o<l;o++){let f=n[t+o],r=e[a+o];if(!f||!r||f.content.length>J||r.content.length>J)continue;let{leftSegments:d,rightSegments:u,hasInlineChanges:c}=ee(f.content,r.content);c&&(f.segments=d,r.segments=u)}}function ee(n,e){let t=q(n,e),s=[],a=[],i=!1;for(let l of t){let o=l.value;if(!l.added&&!l.removed){let r={kind:"context",text:o,emphasis:!1};s.push(r),a.push(r);continue}let f=/[^\s]/.test(o);i=i||f,l.removed&&s.push({kind:"removed",text:o,emphasis:f}),l.added&&a.push({kind:"added",text:o,emphasis:f})}return{leftSegments:s,rightSegments:a,hasInlineChanges:i}}function T(){return{kind:"placeholder",content:"",lineNumber:null}}function F(n,e,t){return{kind:n,content:e,lineNumber:t}}function I(n,e,t){return{kind:n,content:e,lineNumber:t}}function O(n,e){return{left:n,right:e}}function R(n,e,t,s,a){return{kind:n,leftStart:e,leftEnd:t,rightStart:s,rightEnd:a}}function ne(n,e){let t=typeof process<"u"?process.env?.[n]:void 0,s=Number.parseInt(t??"",10);return Number.isFinite(s)&&s>0?s:e}function V(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){s(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),f("Browser host ready.")});function t(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function s(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){new URLSearchParams(window.location.search).get("demo")==="1"&&i();return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,t({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:D(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),d=document.getElementById("web-open-diff"),u=document.getElementById("web-open-diff3"),c=document.getElementById("web-diff-input"),p=document.getElementById("web-diff3-input");r?.addEventListener("click",()=>{i()}),d?.addEventListener("click",()=>{c.value="",c.click()}),u?.addEventListener("click",()=>{p.value="",p.click()}),c?.addEventListener("change",async()=>{let h=Array.from(c.files||[]);if(h.length!==2){f("Select exactly 2 files for a diff.");return}await l(h)}),p?.addEventListener("change",async()=>{let h=Array.from(p.files||[]);if(h.length<1){f("Select one or more files.");return}await o(h)})}function i(){let r=V();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},f("Loaded sample diff."),t({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:D(e.left.content,e.right.content),history:null})}async function l(r){let[d,u]=r,[c,p]=await Promise.all([d.text(),u.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:d.name,content:c},e.right={name:u.name,content:p},f(`Loaded ${d.name} and ${u.name}.`),t({type:"showDiff",file1:d.name,file2:u.name,comparisonId:`web-${e.comparisonId}`,leftContent:c,rightContent:p,diffModel:D(c,p),history:null})}async function o(r){let d=await Promise.all(r.map(async(u,c)=>{let p=await u.text();return{id:`web-panel-${c}`,label:u.name,content:p,savedContent:p,dirty:!1,editable:!0}}));e.mode="multi-diff",f(`Loaded ${d.length}-panel diff for ${d.map(u=>u.label).join(", ")}.`),t({type:"showMultiDiff",panels:d,pairs:d.slice(0,-1).map((u,c)=>({leftIndex:c,rightIndex:c+1,diffModel:D(u.content,d[c+1].content)}))})}function f(r){let d=document.getElementById("web-status");d&&(d.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
