"use strict";(()=>{function R(){}R.prototype={diff:function(e,n){var i,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},s=a.callback;typeof a=="function"&&(s=a,a={}),this.options=a;var d=this;function f(w){return s?(setTimeout(function(){s(void 0,w)},0),!0):w}e=this.castInput(e),n=this.castInput(n),e=this.removeEmpty(this.tokenize(e)),n=this.removeEmpty(this.tokenize(n));var h=n.length,p=e.length,u=1,g=h+p;a.maxEditLength&&(g=Math.min(g,a.maxEditLength));var v=(i=a.timeout)!==null&&i!==void 0?i:1/0,C=Date.now()+v,x=[{oldPos:-1,lastComponent:void 0}],T=this.extractCommon(x[0],n,e,0);if(x[0].oldPos+1>=p&&T+1>=h)return f([{value:this.join(n),count:n.length}]);var I=-1/0,$=1/0;function A(){for(var w=Math.max(I,-u);w<=Math.min($,u);w+=2){var r=void 0,o=x[w-1],l=x[w+1];o&&(x[w-1]=void 0);var c=!1;if(l){var m=l.oldPos-w;c=l&&0<=m&&m<h}var L=o&&o.oldPos+1<p;if(!c&&!L){x[w]=void 0;continue}if(!L||c&&o.oldPos+1<l.oldPos?r=d.addToPath(l,!0,void 0,0):r=d.addToPath(o,void 0,!0,1),T=d.extractCommon(r,n,e,w),r.oldPos+1>=p&&T+1>=h)return f(xe(d,r.lastComponent,n,e,d.useLongestToken));x[w]=r,r.oldPos+1>=p&&($=Math.min($,w-1)),T+1>=h&&(I=Math.max(I,w+1))}u++}if(s)(function w(){setTimeout(function(){if(u>g||Date.now()>C)return s();A()||w()},0)})();else for(;u<=g&&Date.now()<=C;){var U=A();if(U)return U}},addToPath:function(e,n,i,a){var s=e.lastComponent;return s&&s.added===n&&s.removed===i?{oldPos:e.oldPos+a,lastComponent:{count:s.count+1,added:n,removed:i,previousComponent:s.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:n,removed:i,previousComponent:s}}},extractCommon:function(e,n,i,a){for(var s=n.length,d=i.length,f=e.oldPos,h=f-a,p=0;h+1<s&&f+1<d&&this.equals(n[h+1],i[f+1]);)h++,f++,p++;return p&&(e.lastComponent={count:p,previousComponent:e.lastComponent}),e.oldPos=f,h},equals:function(e,n){return this.options.comparator?this.options.comparator(e,n):e===n||this.options.ignoreCase&&e.toLowerCase()===n.toLowerCase()},removeEmpty:function(e){for(var n=[],i=0;i<e.length;i++)e[i]&&n.push(e[i]);return n},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function xe(t,e,n,i,a){for(var s=[],d;e;)s.push(e),d=e.previousComponent,delete e.previousComponent,e=d;s.reverse();for(var f=0,h=s.length,p=0,u=0;f<h;f++){var g=s[f];if(g.removed){if(g.value=t.join(i.slice(u,u+g.count)),u+=g.count,f&&s[f-1].added){var C=s[f-1];s[f-1]=s[f],s[f]=C}}else{if(!g.added&&a){var v=n.slice(p,p+g.count);v=v.map(function(T,I){var $=i[u+I];return $.length>T.length?$:T}),g.value=t.join(v)}else g.value=t.join(n.slice(p,p+g.count));p+=g.count,g.added||(u+=g.count)}}var x=s[h-1];return h>1&&typeof x.value=="string"&&(x.added||x.removed)&&t.equals("",x.value)&&(s[h-2].value+=x.value,s.pop()),s}var Ie=new R;function le(t,e,n){return Ie.diff(t,e,n)}var se=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,ae=/\S/,re=new R;re.equals=function(t,e){return this.options.ignoreCase&&(t=t.toLowerCase(),e=e.toLowerCase()),t===e||this.options.ignoreWhitespace&&!ae.test(t)&&!ae.test(e)};re.tokenize=function(t){for(var e=t.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),n=0;n<e.length-1;n++)!e[n+1]&&e[n+2]&&se.test(e[n])&&se.test(e[n+2])&&(e[n]+=e[n+2],e.splice(n+1,2),n--);return e};function ce(t,e,n){return re.diff(t,e,n)}var fe=new R;fe.tokenize=function(t){this.options.stripTrailingCr&&(t=t.replace(/\r\n/g,`
`));var e=[],n=t.split(/(\n|\r\n)/);n[n.length-1]||n.pop();for(var i=0;i<n.length;i++){var a=n[i];i%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var Le=new R;Le.tokenize=function(t){return t.split(/(\S.+?[.!?])(?=\s+|$)/)};var be=new R;be.tokenize=function(t){return t.split(/([{}:;,]|\s+)/)};function _(t){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?_=function(e){return typeof e}:_=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},_(t)}var Ce=Object.prototype.toString,K=new R;K.useLongestToken=!0;K.tokenize=fe.tokenize;K.castInput=function(t){var e=this.options,n=e.undefinedReplacement,i=e.stringifyReplacer,a=i===void 0?function(s,d){return typeof d>"u"?n:d}:i;return typeof t=="string"?t:JSON.stringify(ne(t,null,null,a),a,"  ")};K.equals=function(t,e){return R.prototype.equals.call(K,t.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function ne(t,e,n,i,a){e=e||[],n=n||[],i&&(t=i(a,t));var s;for(s=0;s<e.length;s+=1)if(e[s]===t)return n[s];var d;if(Ce.call(t)==="[object Array]"){for(e.push(t),d=new Array(t.length),n.push(d),s=0;s<t.length;s+=1)d[s]=ne(t[s],e,n,i,a);return e.pop(),n.pop(),d}if(t&&t.toJSON&&(t=t.toJSON()),_(t)==="object"&&t!==null){e.push(t),d={},n.push(d);var f=[],h;for(h in t)t.hasOwnProperty(h)&&f.push(h);for(f.sort(),s=0;s<f.length;s+=1)h=f[s],d[h]=ne(t[h],e,n,i,h);e.pop(),n.pop()}else d=t;return d}var J=new R;J.tokenize=function(t){return t.slice()};J.join=J.removeEmpty=function(t){return t};function de(t,e,n){return J.diff(t,e,n)}var Ee=500,ue=Ae("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",Ee);function z(t,e){let n=he(t),i=he(e),a=de(n,i),s=[],d=[],f=[],h=[],p=1,u=1;for(let v=0;v<a.length;v++){let C=a[v],x=C.removed?C.value:[],T=C.added?C.value:[];if(!C.added&&!C.removed){for(let I of C.value)d.push(j("context",I,p)),f.push(j("context",I,u)),s.push(Y(G("context",I,p++),G("context",I,u++)));continue}if(C.removed&&v+1<a.length&&a[v+1].added){let I=a[v+1],$=d.length,A=f.length,U=Ne(x,I.value);for(let{left:w,right:r}of U){let o,l;w!==void 0&&(o=j("removed",w,p),d.push(o)),r!==void 0&&(l=j("added",r,u),f.push(l)),o&&l&&Fe(o,l),s.push(Y(w===void 0?V():G("removed",w,p++),r===void 0?V():G("added",r,u++)))}h.push(ie("replace",$,d.length,A,f.length)),v++;continue}if(C.removed){let I=d.length,$=f.length;for(let A of x)d.push(j("removed",A,p)),s.push(Y(G("removed",A,p++),V()));h.push(ie("delete",I,d.length,$,f.length));continue}if(C.added){let I=d.length,$=f.length;for(let A of T)f.push(j("added",A,u)),s.push(Y(V(),G("added",A,u++)));h.push(ie("insert",I,d.length,$,f.length))}}let g=s.some(v=>v.left.kind!=="context"||v.right.kind!=="context");return{rows:s,leftLines:d,rightLines:f,blocks:h,hasChanges:g}}function he(t){if(t.length===0)return[];let e=t.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function Ne(t,e){if(t.length*e.length>1e4)return Te(t,e);let i=0,a=.45,s=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),d=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(null));s[0][0]=0;for(let u=1;u<=t.length;u++)s[u][0]=s[u-1][0]+i,d[u][0]="left";for(let u=1;u<=e.length;u++)s[0][u]=s[0][u-1]+i,d[0][u]="right";for(let u=1;u<=t.length;u++)for(let g=1;g<=e.length;g++){let v=$e(t[u-1],e[g-1]),x=[{move:"match",score:v>a?s[u-1][g-1]+Math.pow(v-a,2):Number.NEGATIVE_INFINITY},{move:"left",score:s[u-1][g]+i},{move:"right",score:s[u][g-1]+i}].reduce((T,I)=>I.score>T.score?I:T);s[u][g]=x.score,d[u][g]=x.move}let f=[],h=t.length,p=e.length;for(;h>0||p>0;){let u=d[h][p];u==="match"?f.push({left:t[--h],right:e[--p]}):u==="left"?f.push({left:t[--h]}):f.push({right:e[--p]})}return f.reverse()}function Te(t,e){let n=Math.max(t.length,e.length);return Array.from({length:n},(i,a)=>({left:t[a],right:e[a]}))}function $e(t,e){let n=t.length+e.length;return n===0?1:2*le(t,e).filter(a=>!a.added&&!a.removed).reduce((a,s)=>a+s.value.length,0)/n}function Fe(t,e){if(t.content.length>ue||e.content.length>ue)return;let{leftSegments:n,rightSegments:i,hasInlineChanges:a}=De(t.content,e.content);a&&(t.segments=n,e.segments=i)}function De(t,e){let n=ce(t,e),i=[],a=[],s=!1;for(let d of n){let f=d.value;if(!d.added&&!d.removed){let p={kind:"context",text:f,emphasis:!1};i.push(p),a.push(p);continue}let h=/[^\s]/.test(f);s=s||h,d.removed&&i.push({kind:"removed",text:f,emphasis:h}),d.added&&a.push({kind:"added",text:f,emphasis:h})}return{leftSegments:i,rightSegments:a,hasInlineChanges:s}}function V(){return{kind:"placeholder",content:"",lineNumber:null}}function G(t,e,n){return{kind:t,content:e,lineNumber:n}}function j(t,e,n){return{kind:t,content:e,lineNumber:n}}function Y(t,e){return{left:t,right:e}}function ie(t,e,n,i,a){return{kind:t,leftStart:e,leftEnd:n,rightStart:i,rightEnd:a}}function Ae(t,e){let n=typeof process<"u"?process.env?.[t]:void 0,i=Number.parseInt(n??"",10);return Number.isFinite(i)&&i>0?i:e}function me(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}function pe(t){if(!k(t)||t.version!==1)throw new Error("Unsupported or missing change-tour manifest version.");if(N(t.title,"title"),N(t.generatedAt,"generatedAt"),t.sourceUrl!==void 0&&N(t.sourceUrl,"sourceUrl"),!k(t.range))throw new Error("Change-tour manifest range must be an object.");for(let n of["baseRef","headRef","mergeBaseOid","headOid"])N(t.range[n],`range.${n}`);if(!k(t.summary))throw new Error("Change-tour manifest summary must be an object.");for(let n of["changedFiles","includedScenes","additions","deletions","commitCount"])X(t.summary[n],`summary.${n}`);if(Z(t.summary.omittedFiles,"summary.omittedFiles"),!Array.isArray(t.commits)||!Array.isArray(t.chapters)||!Array.isArray(t.scenes))throw new Error("Change-tour manifest commits, chapters, and scenes must be arrays.");let e=new Set;for(let[n,i]of t.scenes.entries()){if(we(i,n),e.has(i.id))throw new Error(`Duplicate change-tour scene id: ${i.id}`);e.add(i.id)}for(let[n,i]of t.chapters.entries()){if(!k(i))throw new Error(`chapters[${n}] must be an object.`);N(i.id,`chapters[${n}].id`),N(i.title,`chapters[${n}].title`),Z(i.sceneIds,`chapters[${n}].sceneIds`);for(let a of i.sceneIds)if(!e.has(a))throw new Error(`Chapter references unknown scene id: ${a}`)}if(t.summary.includedScenes!==t.scenes.length)throw new Error("summary.includedScenes must match the number of scenes.");return t}function we(t,e){if(!k(t)||!["text-diff","discussion","walkthrough"].includes(String(t.kind)))throw new Error(`scenes[${e}] must be a text-diff, discussion, or walkthrough scene.`);for(let n of["id","title"])N(t[n],`scenes[${e}].${n}`);if(ke(t,`scenes[${e}]`),t.kind!=="discussion"){if(t.kind==="walkthrough"){if(!Array.isArray(t.steps)||t.steps.length===0)throw new Error(`scenes[${e}].steps must be a non-empty array.`);for(let[n,i]of t.steps.entries()){let a=`scenes[${e}].steps[${n}]`;if(!k(i)||!k(i.focus)||!k(i.diff))throw new Error(`${a} must contain focus and diff objects.`);for(let s of["id","title","body"])N(i[s],`${a}.${s}`);if(oe(i.focus,`${a}.focus`),we(i.diff,e),i.diff.kind!=="text-diff")throw new Error(`${a}.diff must be a text-diff scene.`);if(i.connection!==void 0){if(!k(i.connection))throw new Error(`${a}.connection must be an object.`);N(i.connection.id,`${a}.connection.id`),N(i.connection.label,`${a}.connection.label`),oe(i.connection.from,`${a}.connection.from`),oe(i.connection.to,`${a}.connection.to`)}}return}for(let n of["path","leftLabel","rightLabel","leftContent","rightContent"])N(t[n],`scenes[${e}].${n}`);t.previousPath!==void 0&&N(t.previousPath,`scenes[${e}].previousPath`),N(t.changeKind,`scenes[${e}].changeKind`),X(t.additions,`scenes[${e}].additions`),X(t.deletions,`scenes[${e}].deletions`),t.focusChangeIndex!==void 0&&X(t.focusChangeIndex,`scenes[${e}].focusChangeIndex`)}}function oe(t,e){if(!k(t))throw new Error(`${e} must be an object.`);for(let n of["id","path","revision","excerpt"])N(t[n],`${e}.${n}`);if(t.revision!=="base"&&t.revision!=="head")throw new Error(`${e}.revision must be base or head.`);if(ge(t.startLine,`${e}.startLine`),ge(t.endLine,`${e}.endLine`),Number(t.endLine)<Number(t.startLine))throw new Error(`${e}.endLine must not precede startLine.`)}function ke(t,e){N(t.summary,`${e}.summary`),Z(t.bullets,`${e}.bullets`),Z(t.tags,`${e}.tags`),N(t.takeaway,`${e}.takeaway`)}function k(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function N(t,e){if(typeof t!="string")throw new Error(`${e} must be a string.`)}function Z(t,e){if(!Array.isArray(t)||t.some(n=>typeof n!="string"))throw new Error(`${e} must be an array of strings.`)}function X(t,e){if(!Number.isInteger(t)||Number(t)<0)throw new Error(`${e} must be a non-negative integer.`)}function ge(t,e){if(!Number.isInteger(t)||Number(t)<1)throw new Error(`${e} must be a positive integer.`)}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0,tour:null,activeSceneIndex:-1,activeStepIndex:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){i(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),w("Browser host ready.")});function n(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function i(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){let o=new URLSearchParams(window.location.search),l=o.get("manifest");l?s(l):o.get("demo")==="1"&&$();return}if(r.type==="navigateFile"&&e.mode==="tour"){f(e.activeSceneIndex+(r.direction==="previous"?-1:1));return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:z(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),o=document.getElementById("web-open-diff"),l=document.getElementById("web-open-diff3"),c=document.getElementById("web-diff-input"),m=document.getElementById("web-diff3-input"),L=document.getElementById("tour-previous"),S=document.getElementById("tour-next");r?.addEventListener("click",()=>{$()}),o?.addEventListener("click",()=>{c.value="",c.click()}),l?.addEventListener("click",()=>{m.value="",m.click()}),c?.addEventListener("change",async()=>{let y=Array.from(c.files||[]);if(y.length!==2){w("Select exactly 2 files for a diff.");return}await A(y)}),m?.addEventListener("change",async()=>{let y=Array.from(m.files||[]);if(y.length<1){w("Select one or more files.");return}await U(y)}),L?.addEventListener("click",()=>g(-1)),S?.addEventListener("click",()=>g(1)),window.addEventListener("keydown",y=>{e.mode!=="tour"||y.metaKey||y.ctrlKey||y.altKey||(y.key==="PageUp"||y.key==="ArrowLeft"?(y.preventDefault(),g(-1)):(y.key==="PageDown"||y.key==="ArrowRight")&&(y.preventDefault(),g(1)))})}async function s(r){w("Loading change tour\u2026");try{let o=await fetch(r,{cache:"no-store"});if(!o.ok)throw new Error(`Manifest request failed (${o.status}).`);e.tour=pe(await o.json()),e.mode="tour",document.body.classList.add("tour-mode"),d();let l=new URLSearchParams(window.location.search).get("scene"),c=e.tour.scenes.findIndex(m=>m.id===l);f(c>=0?c:0),w("")}catch(o){w(`Could not load change tour: ${o instanceof Error?o.message:String(o)}`)}}function d(){let r=e.tour;if(!r)return;let o=document.getElementById("tour-shell"),l=document.getElementById("tour-title"),c=document.getElementById("tour-source"),m=document.getElementById("tour-range"),L=document.getElementById("tour-stats"),S=document.getElementById("tour-scenes"),y=document.getElementById("tour-commits"),H=document.getElementById("tour-commits-summary");if(!o||!l||!c||!m||!L||!S||!y||!H)throw new Error("Presenter UI is incomplete.");o.hidden=!1,l.textContent=r.title,r.sourceUrl?(c.href=r.sourceUrl,c.hidden=!1):c.hidden=!0;let B=T(r.range.baseRef),F=T(r.range.headRef),P=r.range.headOid.slice(0,7);m.textContent=`${B} \u2192 ${F}${F===P?"":` \xB7 ${P}`}`,L.textContent=`${r.summary.changedFiles} files \xB7 +${r.summary.additions} \u2212${r.summary.deletions} \xB7 ${r.summary.commitCount} commits`,H.textContent=`${r.summary.commitCount} commits`,S.replaceChildren();let W=new Map(r.scenes.map(E=>[E.id,E]));for(let E of r.chapters){let O=document.createElement("h2");O.className="tour-chapter-title",O.textContent=E.title,S.append(O);for(let M of E.sceneIds){let b=W.get(M);if(!b)continue;let q=r.scenes.indexOf(b),D=document.createElement("button");D.type="button",D.className="tour-scene",D.dataset.sceneId=b.id,D.title=b.kind==="text-diff"?b.path:b.title,D.addEventListener("click",()=>f(q));let Q=document.createElement("span");Q.className="tour-scene-number",Q.textContent=String(q+1).padStart(2,"0");let ee=document.createElement("span");ee.className="tour-scene-copy";for(let[ye,ve]of[["tour-scene-title",b.title],["tour-scene-path",b.kind==="text-diff"?b.path:b.kind==="walkthrough"?`${b.steps.length} code steps`:"Discussion"],["tour-scene-note",b.takeaway]]){let te=document.createElement("span");te.className=ye,te.textContent=ve,ee.append(te)}D.append(Q,ee),S.append(D)}}y.replaceChildren(...r.commits.map(E=>{let O=document.createElement("li"),M=document.createElement("span");return M.className="tour-commit-oid",M.textContent=E.shortOid,O.append(M,document.createTextNode(E.summary)),O}))}function f(r,o=0){let l=e.tour;if(!l||r<0||r>=l.scenes.length)return;let c=l.scenes[r];e.activeSceneIndex=r,e.activeStepIndex=c.kind==="walkthrough"?Math.min(Math.max(o,0),Math.max(c.steps.length-1,0)):0;let m=v(l,r);document.querySelectorAll(".tour-scene").forEach(S=>{S.classList.toggle("is-active",S.dataset.sceneId===c.id)}),document.querySelector(`.tour-scene[data-scene-id="${c.id}"]`)?.scrollIntoView({block:"nearest"}),I(c,m);let L=new URLSearchParams(window.location.search);if(L.set("scene",c.id),window.history.replaceState(null,"",`${window.location.pathname}?${L.toString()}`),c.kind==="discussion"){document.body.classList.add("tour-discussion");return}if(document.body.classList.remove("tour-discussion"),c.kind==="walkthrough"){p(c);return}h(c,r)}function h(r,o,l=null,c=r.id){let m=e.tour;if(!m)return;let L=z(r.leftContent,r.rightContent);n({type:"showDiff",file1:r.leftLabel,file2:r.rightLabel,comparisonId:`tour-${c}`,leftContent:r.leftContent,rightContent:r.rightContent,diffModel:L,history:null,fileNavigation:{canGoPrevious:o>0,canGoNext:o<m.scenes.length-1},editableSides:{left:!1,right:!1},comparisonSummary:`${r.path} \xB7 ${r.takeaway}`,initialChangeIndex:l?x(L,l.side,l.startLine):r.focusChangeIndex,tourAnnotation:l})}function p(r){let o=r.steps[e.activeStepIndex];if(!o)return;let l=o.focus.revision==="base"?"left":"right";h(o.diff,e.activeSceneIndex,{side:l,startLine:o.focus.startLine,endLine:o.focus.endLine,label:`${o.title}: ${o.body}`},`${r.id}-${o.id}`)}function u(r){let o=e.tour,l=o?.scenes[e.activeSceneIndex];if(!o||!l||r===0)return null;if(r>0)return l.kind==="walkthrough"&&e.activeStepIndex<l.steps.length-1?{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex+1}:e.activeSceneIndex<o.scenes.length-1?{sceneIndex:e.activeSceneIndex+1,stepIndex:0}:null;if(l.kind==="walkthrough"&&e.activeStepIndex>0)return{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex-1};if(e.activeSceneIndex>0){let c=o.scenes[e.activeSceneIndex-1];return{sceneIndex:e.activeSceneIndex-1,stepIndex:c.kind==="walkthrough"?c.steps.length-1:0}}return null}function g(r){let o=u(r);return o?(f(o.sceneIndex,o.stepIndex),!0):!1}function v(r,o){let l=r.scenes[o],c=r.chapters.findIndex(y=>y.sceneIds.includes(l.id)),m=c>=0?r.chapters[c]:null,L=m?m.sceneIds.indexOf(l.id)+1:o+1,S=m?m.sceneIds.length:r.scenes.length;return{chapter:m,chapterIndex:c,chapterNumber:c>=0?c+1:o+1,sceneInChapter:L,scenesInChapter:S}}function C(r,o,l){let c=[`Ch ${r.chapterNumber}`,`Scene ${r.sceneInChapter}/${r.scenesInChapter}`];return o.kind==="walkthrough"&&c.push(`Step ${l+1}/${o.steps.length}`),c.join(" \xB7 ")}function x(r,o,l){let m=(o==="left"?r.leftLines:r.rightLines).findIndex(F=>F.lineNumber===l);if(m<0)return 0;let L=o==="left"?"leftStart":"rightStart",S=o==="left"?"leftEnd":"rightEnd",y=r.blocks.findIndex(F=>m>=F[L]&&m<F[S]);if(y>=0)return y;let H=0,B=Number.POSITIVE_INFINITY;return r.blocks.forEach((F,P)=>{let W=Math.min(Math.abs(m-F[L]),Math.abs(m-F[S]));W<B&&(H=P,B=W)}),H}function T(r){return/^[0-9a-f]{40}$/i.test(r)?r.slice(0,7):r}function I(r,o){let l=document.getElementById("tour-narrative"),c=document.getElementById("tour-breadcrumb"),m=document.getElementById("tour-narrative-chapter"),L=document.getElementById("tour-narrative-title"),S=document.getElementById("tour-narrative-summary"),y=document.getElementById("tour-narrative-bullets"),H=document.getElementById("tour-narrative-tags"),B=document.getElementById("tour-narrative-takeaway"),F=document.getElementById("tour-step"),P=document.getElementById("tour-step-title"),W=document.getElementById("tour-step-body"),E=document.getElementById("tour-connection"),O=document.getElementById("tour-previous"),M=document.getElementById("tour-next");if(!l||!c||!m||!L||!S||!y||!H||!B||!F||!P||!W||!E||!O||!M)throw new Error("Tour narrative UI is incomplete.");l.hidden=!1,c.textContent=C(o,r,e.activeStepIndex),m.textContent=o.chapter?.title||"Change tour",L.textContent=r.title,S.textContent=r.summary,y.replaceChildren(...r.bullets.map(q=>{let D=document.createElement("li");return D.textContent=q,D})),H.replaceChildren(...r.tags.map(q=>{let D=document.createElement("span");return D.textContent=q,D})),B.textContent=r.takeaway;let b=r.kind==="walkthrough"?r.steps[e.activeStepIndex]:null;F.hidden=!b,b?(P.textContent=b.title,W.textContent=b.body,b.connection?(E.hidden=!1,E.textContent=`${b.connection.from.path} \u2192 ${b.connection.to.path} \xB7 ${b.connection.label}`):(E.hidden=!0,E.textContent="")):(E.hidden=!0,E.textContent=""),O.disabled=!u(-1),M.disabled=!u(1)}function $(){let r=me();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},w("Loaded sample diff."),n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:z(e.left.content,e.right.content),history:null})}async function A(r){let[o,l]=r,[c,m]=await Promise.all([o.text(),l.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:o.name,content:c},e.right={name:l.name,content:m},w(`Loaded ${o.name} and ${l.name}.`),n({type:"showDiff",file1:o.name,file2:l.name,comparisonId:`web-${e.comparisonId}`,leftContent:c,rightContent:m,diffModel:z(c,m),history:null})}async function U(r){let o=await Promise.all(r.map(async(l,c)=>{let m=await l.text();return{id:`web-panel-${c}`,label:l.name,content:m,savedContent:m,dirty:!1,editable:!0}}));e.mode="multi-diff",w(`Loaded ${o.length}-panel diff for ${o.map(l=>l.label).join(", ")}.`),n({type:"showMultiDiff",panels:o,pairs:o.slice(0,-1).map((l,c)=>({leftIndex:c,rightIndex:c+1,diffModel:z(l.content,o[c+1].content)}))})}function w(r){let o=document.getElementById("web-status");o&&(o.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
