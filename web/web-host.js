"use strict";(()=>{function P(){}P.prototype={diff:function(e,n){var i,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},o=a.callback;typeof a=="function"&&(o=a,a={}),this.options=a;var f=this;function l(v){return o?(setTimeout(function(){o(void 0,v)},0),!0):v}e=this.castInput(e),n=this.castInput(n),e=this.removeEmpty(this.tokenize(e)),n=this.removeEmpty(this.tokenize(n));var h=n.length,p=e.length,u=1,m=h+p;a.maxEditLength&&(m=Math.min(m,a.maxEditLength));var w=(i=a.timeout)!==null&&i!==void 0?i:1/0,S=Date.now()+w,I=[{oldPos:-1,lastComponent:void 0}],F=this.extractCommon(I[0],n,e,0);if(I[0].oldPos+1>=p&&F+1>=h)return l([{value:this.join(n),count:n.length}]);var x=-1/0,T=1/0;function O(){for(var v=Math.max(x,-u);v<=Math.min(T,u);v+=2){var D=void 0,R=I[v-1],b=I[v+1];R&&(I[v-1]=void 0);var r=!1;if(b){var s=b.oldPos-v;r=b&&0<=s&&s<h}var d=R&&R.oldPos+1<p;if(!r&&!d){I[v]=void 0;continue}if(!d||r&&R.oldPos+1<b.oldPos?D=f.addToPath(b,!0,void 0,0):D=f.addToPath(R,void 0,!0,1),F=f.extractCommon(D,n,e,v),D.oldPos+1>=p&&F+1>=h)return l(Ee(f,D.lastComponent,n,e,f.useLongestToken));I[v]=D,D.oldPos+1>=p&&(T=Math.min(T,v-1)),F+1>=h&&(x=Math.max(x,v+1))}u++}if(o)(function v(){setTimeout(function(){if(u>m||Date.now()>S)return o();O()||v()},0)})();else for(;u<=m&&Date.now()<=S;){var j=O();if(j)return j}},addToPath:function(e,n,i,a){var o=e.lastComponent;return o&&o.added===n&&o.removed===i?{oldPos:e.oldPos+a,lastComponent:{count:o.count+1,added:n,removed:i,previousComponent:o.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:n,removed:i,previousComponent:o}}},extractCommon:function(e,n,i,a){for(var o=n.length,f=i.length,l=e.oldPos,h=l-a,p=0;h+1<o&&l+1<f&&this.equals(n[h+1],i[l+1]);)h++,l++,p++;return p&&(e.lastComponent={count:p,previousComponent:e.lastComponent}),e.oldPos=l,h},equals:function(e,n){return this.options.comparator?this.options.comparator(e,n):e===n||this.options.ignoreCase&&e.toLowerCase()===n.toLowerCase()},removeEmpty:function(e){for(var n=[],i=0;i<e.length;i++)e[i]&&n.push(e[i]);return n},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function Ee(t,e,n,i,a){for(var o=[],f;e;)o.push(e),f=e.previousComponent,delete e.previousComponent,e=f;o.reverse();for(var l=0,h=o.length,p=0,u=0;l<h;l++){var m=o[l];if(m.removed){if(m.value=t.join(i.slice(u,u+m.count)),u+=m.count,l&&o[l-1].added){var S=o[l-1];o[l-1]=o[l],o[l]=S}}else{if(!m.added&&a){var w=n.slice(p,p+m.count);w=w.map(function(F,x){var T=i[u+x];return T.length>F.length?T:F}),m.value=t.join(w)}else m.value=t.join(n.slice(p,p+m.count));p+=m.count,m.added||(u+=m.count)}}var I=o[h-1];return h>1&&typeof I.value=="string"&&(I.added||I.removed)&&t.equals("",I.value)&&(o[h-2].value+=I.value,o.pop()),o}var Se=new P;function de(t,e,n){return Se.diff(t,e,n)}var ce=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,fe=/\S/,se=new P;se.equals=function(t,e){return this.options.ignoreCase&&(t=t.toLowerCase(),e=e.toLowerCase()),t===e||this.options.ignoreWhitespace&&!fe.test(t)&&!fe.test(e)};se.tokenize=function(t){for(var e=t.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),n=0;n<e.length-1;n++)!e[n+1]&&e[n+2]&&ce.test(e[n])&&ce.test(e[n+2])&&(e[n]+=e[n+2],e.splice(n+1,2),n--);return e};function ue(t,e,n){return se.diff(t,e,n)}var he=new P;he.tokenize=function(t){this.options.stripTrailingCr&&(t=t.replace(/\r\n/g,`
`));var e=[],n=t.split(/(\n|\r\n)/);n[n.length-1]||n.pop();for(var i=0;i<n.length;i++){var a=n[i];i%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var Te=new P;Te.tokenize=function(t){return t.split(/(\S.+?[.!?])(?=\s+|$)/)};var Ne=new P;Ne.tokenize=function(t){return t.split(/([{}:;,]|\s+)/)};function Y(t){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?Y=function(e){return typeof e}:Y=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},Y(t)}var $e=Object.prototype.toString,V=new P;V.useLongestToken=!0;V.tokenize=he.tokenize;V.castInput=function(t){var e=this.options,n=e.undefinedReplacement,i=e.stringifyReplacer,a=i===void 0?function(o,f){return typeof f>"u"?n:f}:i;return typeof t=="string"?t:JSON.stringify(oe(t,null,null,a),a,"  ")};V.equals=function(t,e){return P.prototype.equals.call(V,t.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function oe(t,e,n,i,a){e=e||[],n=n||[],i&&(t=i(a,t));var o;for(o=0;o<e.length;o+=1)if(e[o]===t)return n[o];var f;if($e.call(t)==="[object Array]"){for(e.push(t),f=new Array(t.length),n.push(f),o=0;o<t.length;o+=1)f[o]=oe(t[o],e,n,i,a);return e.pop(),n.pop(),f}if(t&&t.toJSON&&(t=t.toJSON()),Y(t)==="object"&&t!==null){e.push(t),f={},n.push(f);var l=[],h;for(h in t)t.hasOwnProperty(h)&&l.push(h);for(l.sort(),o=0;o<l.length;o+=1)h=l[o],f[h]=oe(t[h],e,n,i,h);e.pop(),n.pop()}else f=t;return f}var X=new P;X.tokenize=function(t){return t.slice()};X.join=X.removeEmpty=function(t){return t};function me(t,e,n){return X.diff(t,e,n)}var De=500,ge=Me("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",De);function J(t,e){let n=pe(t),i=pe(e),a=me(n,i),o=[],f=[],l=[],h=[],p=1,u=1;for(let w=0;w<a.length;w++){let S=a[w],I=S.removed?S.value:[],F=S.added?S.value:[];if(!S.added&&!S.removed){for(let x of S.value)f.push(_("context",x,p)),l.push(_("context",x,u)),o.push(Q(K("context",x,p++),K("context",x,u++)));continue}if(S.removed&&w+1<a.length&&a[w+1].added){let x=a[w+1],T=f.length,O=l.length,j=ke(I,x.value);for(let{left:v,right:D}of j){let R,b;v!==void 0&&(R=_("removed",v,p),f.push(R)),D!==void 0&&(b=_("added",D,u),l.push(b)),R&&b&&Re(R,b),o.push(Q(v===void 0?Z():K("removed",v,p++),D===void 0?Z():K("added",D,u++)))}h.push(ae("replace",T,f.length,O,l.length)),w++;continue}if(S.removed){let x=f.length,T=l.length;for(let O of I)f.push(_("removed",O,p)),o.push(Q(K("removed",O,p++),Z()));h.push(ae("delete",x,f.length,T,l.length));continue}if(S.added){let x=f.length,T=l.length;for(let O of F)l.push(_("added",O,u)),o.push(Q(Z(),K("added",O,u++)));h.push(ae("insert",x,f.length,T,l.length))}}let m=o.some(w=>w.left.kind!=="context"||w.right.kind!=="context");return{rows:o,leftLines:f,rightLines:l,blocks:h,hasChanges:m}}function pe(t){if(t.length===0)return[];let e=t.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function ke(t,e){if(t.length*e.length>1e4)return Ae(t,e);let i=0,a=.45,o=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),f=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(null));o[0][0]=0;for(let u=1;u<=t.length;u++)o[u][0]=o[u-1][0]+i,f[u][0]="left";for(let u=1;u<=e.length;u++)o[0][u]=o[0][u-1]+i,f[0][u]="right";for(let u=1;u<=t.length;u++)for(let m=1;m<=e.length;m++){let w=Oe(t[u-1],e[m-1]),I=[{move:"match",score:w>a?o[u-1][m-1]+Math.pow(w-a,2):Number.NEGATIVE_INFINITY},{move:"left",score:o[u-1][m]+i},{move:"right",score:o[u][m-1]+i}].reduce((F,x)=>x.score>F.score?x:F);o[u][m]=I.score,f[u][m]=I.move}let l=[],h=t.length,p=e.length;for(;h>0||p>0;){let u=f[h][p];u==="match"?l.push({left:t[--h],right:e[--p]}):u==="left"?l.push({left:t[--h]}):l.push({right:e[--p]})}return l.reverse()}function Ae(t,e){let n=Math.max(t.length,e.length);return Array.from({length:n},(i,a)=>({left:t[a],right:e[a]}))}function Oe(t,e){let n=t.length+e.length;return n===0?1:2*de(t,e).filter(a=>!a.added&&!a.removed).reduce((a,o)=>a+o.value.length,0)/n}function Re(t,e){if(t.content.length>ge||e.content.length>ge)return;let{leftSegments:n,rightSegments:i,hasInlineChanges:a}=He(t.content,e.content);a&&(t.segments=n,e.segments=i)}function He(t,e){let n=ue(t,e),i=[],a=[],o=!1;for(let f of n){let l=f.value;if(!f.added&&!f.removed){let p={kind:"context",text:l,emphasis:!1};i.push(p),a.push(p);continue}let h=/[^\s]/.test(l);o=o||h,f.removed&&i.push({kind:"removed",text:l,emphasis:h}),f.added&&a.push({kind:"added",text:l,emphasis:h})}return{leftSegments:i,rightSegments:a,hasInlineChanges:o}}function Z(){return{kind:"placeholder",content:"",lineNumber:null}}function K(t,e,n){return{kind:t,content:e,lineNumber:n}}function _(t,e,n){return{kind:t,content:e,lineNumber:n}}function Q(t,e){return{left:t,right:e}}function ae(t,e,n,i,a){return{kind:t,leftStart:e,leftEnd:n,rightStart:i,rightEnd:a}}function Me(t,e){let n=typeof process<"u"?process.env?.[t]:void 0,i=Number.parseInt(n??"",10);return Number.isFinite(i)&&i>0?i:e}function ye(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}function ve(t){if(!H(t)||t.version!==1)throw new Error("Unsupported or missing change-tour manifest version.");if($(t.title,"title"),$(t.generatedAt,"generatedAt"),t.sourceUrl!==void 0&&$(t.sourceUrl,"sourceUrl"),!H(t.range))throw new Error("Change-tour manifest range must be an object.");for(let n of["baseRef","headRef","mergeBaseOid","headOid"])$(t.range[n],`range.${n}`);if(!H(t.summary))throw new Error("Change-tour manifest summary must be an object.");for(let n of["changedFiles","includedScenes","additions","deletions","commitCount"])ee(t.summary[n],`summary.${n}`);if(te(t.summary.omittedFiles,"summary.omittedFiles"),!Array.isArray(t.commits)||!Array.isArray(t.chapters)||!Array.isArray(t.scenes))throw new Error("Change-tour manifest commits, chapters, and scenes must be arrays.");let e=new Set;for(let[n,i]of t.scenes.entries()){if(xe(i,n),e.has(i.id))throw new Error(`Duplicate change-tour scene id: ${i.id}`);e.add(i.id)}for(let[n,i]of t.chapters.entries()){if(!H(i))throw new Error(`chapters[${n}] must be an object.`);$(i.id,`chapters[${n}].id`),$(i.title,`chapters[${n}].title`),te(i.sceneIds,`chapters[${n}].sceneIds`);for(let a of i.sceneIds)if(!e.has(a))throw new Error(`Chapter references unknown scene id: ${a}`)}if(t.summary.includedScenes!==t.scenes.length)throw new Error("summary.includedScenes must match the number of scenes.");return t}function xe(t,e){if(!H(t)||!["text-diff","discussion","walkthrough"].includes(String(t.kind)))throw new Error(`scenes[${e}] must be a text-diff, discussion, or walkthrough scene.`);for(let n of["id","title"])$(t[n],`scenes[${e}].${n}`);if(Pe(t,`scenes[${e}]`),t.kind!=="discussion"){if(t.kind==="walkthrough"){if(!Array.isArray(t.steps)||t.steps.length===0)throw new Error(`scenes[${e}].steps must be a non-empty array.`);for(let[n,i]of t.steps.entries()){let a=`scenes[${e}].steps[${n}]`;if(!H(i)||!H(i.focus)||!H(i.diff))throw new Error(`${a} must contain focus and diff objects.`);for(let o of["id","title","body"])$(i[o],`${a}.${o}`);if(le(i.focus,`${a}.focus`),xe(i.diff,e),i.diff.kind!=="text-diff")throw new Error(`${a}.diff must be a text-diff scene.`);if(i.connection!==void 0){if(!H(i.connection))throw new Error(`${a}.connection must be an object.`);$(i.connection.id,`${a}.connection.id`),$(i.connection.label,`${a}.connection.label`),le(i.connection.from,`${a}.connection.from`),le(i.connection.to,`${a}.connection.to`)}}return}for(let n of["path","leftLabel","rightLabel","leftContent","rightContent"])$(t[n],`scenes[${e}].${n}`);t.previousPath!==void 0&&$(t.previousPath,`scenes[${e}].previousPath`),$(t.changeKind,`scenes[${e}].changeKind`),ee(t.additions,`scenes[${e}].additions`),ee(t.deletions,`scenes[${e}].deletions`),t.focusChangeIndex!==void 0&&ee(t.focusChangeIndex,`scenes[${e}].focusChangeIndex`)}}function le(t,e){if(!H(t))throw new Error(`${e} must be an object.`);for(let n of["id","path","revision","excerpt"])$(t[n],`${e}.${n}`);if(t.revision!=="base"&&t.revision!=="head")throw new Error(`${e}.revision must be base or head.`);if(we(t.startLine,`${e}.startLine`),we(t.endLine,`${e}.endLine`),Number(t.endLine)<Number(t.startLine))throw new Error(`${e}.endLine must not precede startLine.`)}function Pe(t,e){$(t.summary,`${e}.summary`),te(t.bullets,`${e}.bullets`),te(t.tags,`${e}.tags`),$(t.takeaway,`${e}.takeaway`)}function H(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function $(t,e){if(typeof t!="string")throw new Error(`${e} must be a string.`)}function te(t,e){if(!Array.isArray(t)||t.some(n=>typeof n!="string"))throw new Error(`${e} must be an array of strings.`)}function ee(t,e){if(!Number.isInteger(t)||Number(t)<0)throw new Error(`${e} must be a non-negative integer.`)}function we(t,e){if(!Number.isInteger(t)||Number(t)<1)throw new Error(`${e} must be a positive integer.`)}function Ie(t,e,n){let i=t.findIndex(l=>l.id===e),a=i>=0?i:0,o=t[a];if(!o||o.kind!=="walkthrough"||!n)return{sceneIndex:a,stepIndex:0};let f=o.steps.findIndex(l=>l.id===n);return{sceneIndex:a,stepIndex:f>=0?f:0}}function Le(t,e,n){let i=t[e.sceneIndex];if(!i)return null;if(n>0)return i.kind==="walkthrough"&&e.stepIndex<i.steps.length-1?{sceneIndex:e.sceneIndex,stepIndex:e.stepIndex+1}:e.sceneIndex<t.length-1?{sceneIndex:e.sceneIndex+1,stepIndex:0}:null;if(i.kind==="walkthrough"&&e.stepIndex>0)return{sceneIndex:e.sceneIndex,stepIndex:e.stepIndex-1};if(e.sceneIndex===0)return null;let a=t[e.sceneIndex-1];return{sceneIndex:e.sceneIndex-1,stepIndex:a.kind==="walkthrough"?a.steps.length-1:0}}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0,tour:null,activeSceneIndex:-1,activeStepIndex:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){i(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),b("Browser host ready.")});function n(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function i(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){let s=new URLSearchParams(window.location.search),d=s.get("manifest");d?o(d):s.get("demo")==="1"&&v();return}if(r.type==="navigateFile"&&e.mode==="tour"){w(r.direction==="previous"?-1:1);return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:J(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),s=document.getElementById("web-open-diff"),d=document.getElementById("web-open-diff3"),c=document.getElementById("web-diff-input"),g=document.getElementById("web-diff3-input"),C=document.getElementById("tour-previous"),E=document.getElementById("tour-next");r?.addEventListener("click",()=>{v()}),s?.addEventListener("click",()=>{c.value="",c.click()}),d?.addEventListener("click",()=>{g.value="",g.click()}),c?.addEventListener("change",async()=>{let y=Array.from(c.files||[]);if(y.length!==2){b("Select exactly 2 files for a diff.");return}await D(y)}),g?.addEventListener("change",async()=>{let y=Array.from(g.files||[]);if(y.length<1){b("Select one or more files.");return}await R(y)}),C?.addEventListener("click",()=>w(-1)),E?.addEventListener("click",()=>w(1)),window.addEventListener("keydown",y=>{e.mode!=="tour"||y.metaKey||y.ctrlKey||y.altKey||O(y.target)||(y.key==="PageUp"||y.key==="ArrowLeft"?(y.preventDefault(),w(-1)):(y.key==="PageDown"||y.key==="ArrowRight")&&(y.preventDefault(),w(1)))})}async function o(r){b("Loading change tour\u2026");try{let s=await fetch(r,{cache:"no-store"});if(!s.ok)throw new Error(`Manifest request failed (${s.status}).`);e.tour=ve(await s.json()),e.mode="tour",document.body.classList.add("tour-mode"),f();let d=new URLSearchParams(window.location.search),c=Ie(e.tour.scenes,d.get("scene"),d.get("step"));l(c.sceneIndex,c.stepIndex),b("")}catch(s){b(`Could not load change tour: ${s instanceof Error?s.message:String(s)}`)}}function f(){let r=e.tour;if(!r)return;let s=document.getElementById("tour-shell"),d=document.getElementById("tour-title"),c=document.getElementById("tour-source"),g=document.getElementById("tour-range"),C=document.getElementById("tour-stats"),E=document.getElementById("tour-scenes"),y=document.getElementById("tour-commits"),B=document.getElementById("tour-commits-summary");if(!s||!d||!c||!g||!C||!E||!y||!B)throw new Error("Presenter UI is incomplete.");s.hidden=!1,d.textContent=r.title,r.sourceUrl?(c.href=r.sourceUrl,c.hidden=!1):c.hidden=!0;let U=x(r.range.baseRef),k=x(r.range.headRef),q=r.range.headOid.slice(0,7);g.textContent=`${U} \u2192 ${k}${k===q?"":` \xB7 ${q}`}`,C.textContent=`${T(r.summary.changedFiles,"file")} \xB7 +${r.summary.additions} \u2212${r.summary.deletions} \xB7 ${T(r.summary.commitCount,"commit")}`,B.textContent=T(r.summary.commitCount,"commit"),E.replaceChildren();let G=new Map(r.scenes.map(N=>[N.id,N]));for(let N of r.chapters){let M=document.createElement("h2");M.className="tour-chapter-title",M.textContent=N.title,E.append(M);for(let W of N.sceneIds){let L=G.get(W);if(!L)continue;let z=r.scenes.indexOf(L),A=document.createElement("button");A.type="button",A.className="tour-scene",A.dataset.sceneId=L.id,A.title=L.kind==="text-diff"?L.path:L.title,A.addEventListener("click",()=>l(z));let ne=document.createElement("span");ne.className="tour-scene-number",ne.textContent=String(z+1).padStart(2,"0");let re=document.createElement("span");re.className="tour-scene-copy";for(let[be,Ce]of[["tour-scene-title",L.title],["tour-scene-path",L.kind==="text-diff"?L.path:L.kind==="walkthrough"?T(L.steps.length,"code step"):"Discussion"],["tour-scene-note",L.takeaway]]){let ie=document.createElement("span");ie.className=be,ie.textContent=Ce,re.append(ie)}A.append(ne,re),E.append(A)}}y.replaceChildren(...r.commits.map(N=>{let M=document.createElement("li"),W=document.createElement("span");return W.className="tour-commit-oid",W.textContent=N.shortOid,M.append(W,document.createTextNode(N.summary)),M}))}function l(r,s=0){let d=e.tour;if(!d||r<0||r>=d.scenes.length)return;let c=d.scenes[r];e.activeSceneIndex=r,e.activeStepIndex=c.kind==="walkthrough"?Math.min(Math.max(s,0),Math.max(c.steps.length-1,0)):0;let g=S(d,r);document.querySelectorAll(".tour-scene").forEach(E=>{E.classList.toggle("is-active",E.dataset.sceneId===c.id)}),document.querySelector(`.tour-scene[data-scene-id="${c.id}"]`)?.scrollIntoView({block:"nearest"}),j(c,g);let C=new URLSearchParams(window.location.search);if(C.set("scene",c.id),c.kind==="walkthrough"?C.set("step",c.steps[e.activeStepIndex].id):C.delete("step"),window.history.replaceState(null,"",`${window.location.pathname}?${C.toString()}`),c.kind==="discussion"){document.body.classList.add("tour-discussion");return}if(document.body.classList.remove("tour-discussion"),c.kind==="walkthrough"){u(c);return}h(c)}function h(r,s=null,d=r.id){if(!e.tour)return;let g=J(r.leftContent,r.rightContent),C=p(r,r.leftLabel,"base"),E=p(r,r.rightLabel,"head");n({type:"showDiff",file1:C,file2:E,comparisonId:`tour-${d}`,leftContent:r.leftContent,rightContent:r.rightContent,diffModel:g,history:null,fileNavigation:{canGoPrevious:!!m(-1),canGoNext:!!m(1)},editableSides:{left:!1,right:!1},comparisonSummary:`${r.path} \xB7 ${r.takeaway}`,initialChangeIndex:s?F(g,s.side,s.startLine):r.focusChangeIndex,tourAnnotation:s})}function p(r,s,d){let c=s.startsWith(r.path)?s.slice(r.path.length).trim():s.trim();return c?`${d} ${c}`:d}function u(r){let s=r.steps[e.activeStepIndex];if(!s)return;let d=s.focus.revision==="base"?"left":"right";h(s.diff,{side:d,startLine:s.focus.startLine,endLine:s.focus.endLine,label:`${s.title}: ${s.body}`},`${r.id}-${s.id}`)}function m(r){let s=e.tour;return!s||r!==-1&&r!==1?null:Le(s.scenes,{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex},r)}function w(r){let s=m(r);return s?(l(s.sceneIndex,s.stepIndex),!0):!1}function S(r,s){let d=r.scenes[s],c=r.chapters.findIndex(y=>y.sceneIds.includes(d.id)),g=c>=0?r.chapters[c]:null,C=g?g.sceneIds.indexOf(d.id)+1:s+1,E=g?g.sceneIds.length:r.scenes.length;return{chapter:g,chapterIndex:c,chapterNumber:c>=0?c+1:s+1,sceneInChapter:C,scenesInChapter:E}}function I(r,s,d){let c=[`Ch ${r.chapterNumber}`,`Scene ${r.sceneInChapter}/${r.scenesInChapter}`];return s.kind==="walkthrough"&&c.push(`Step ${d+1}/${s.steps.length}`),c.join(" \xB7 ")}function F(r,s,d){let g=(s==="left"?r.leftLines:r.rightLines).findIndex(k=>k.lineNumber===d);if(g<0)return 0;let C=s==="left"?"leftStart":"rightStart",E=s==="left"?"leftEnd":"rightEnd",y=r.blocks.findIndex(k=>g>=k[C]&&g<k[E]);if(y>=0)return y;let B=0,U=Number.POSITIVE_INFINITY;return r.blocks.forEach((k,q)=>{let G=Math.min(Math.abs(g-k[C]),Math.abs(g-k[E]));G<U&&(B=q,U=G)}),B}function x(r){return/^[0-9a-f]{40}$/i.test(r)?r.slice(0,7):r}function T(r,s){return`${r} ${r===1?s:`${s}s`}`}function O(r){return r instanceof Element&&!!r.closest('a, button, input, select, summary, textarea, [contenteditable="true"], [role="textbox"], .monaco-editor')}function j(r,s){let d=document.getElementById("tour-narrative"),c=document.getElementById("tour-breadcrumb"),g=document.getElementById("tour-narrative-chapter"),C=document.getElementById("tour-narrative-title"),E=document.getElementById("tour-narrative-summary"),y=document.getElementById("tour-narrative-bullets"),B=document.getElementById("tour-narrative-tags"),U=document.getElementById("tour-narrative-takeaway"),k=document.getElementById("tour-step"),q=document.getElementById("tour-step-title"),G=document.getElementById("tour-step-body"),N=document.getElementById("tour-connection"),M=document.getElementById("tour-previous"),W=document.getElementById("tour-next");if(!d||!c||!g||!C||!E||!y||!B||!U||!k||!q||!G||!N||!M||!W)throw new Error("Tour narrative UI is incomplete.");d.hidden=!1,c.textContent=I(s,r,e.activeStepIndex),g.textContent=s.chapter?.title||"Change tour",C.textContent=r.title,E.textContent=r.summary,y.replaceChildren(...r.bullets.map(z=>{let A=document.createElement("li");return A.textContent=z,A})),B.replaceChildren(...r.tags.map(z=>{let A=document.createElement("span");return A.textContent=z,A})),U.textContent=r.takeaway;let L=r.kind==="walkthrough"?r.steps[e.activeStepIndex]:null;k.hidden=!L,L?(q.textContent=L.title,G.textContent=L.body,L.connection?(N.hidden=!1,N.textContent=`${L.connection.from.path} \u2192 ${L.connection.to.path} \xB7 ${L.connection.label}`):(N.hidden=!0,N.textContent="")):(N.hidden=!0,N.textContent=""),M.disabled=!m(-1),W.disabled=!m(1)}function v(){let r=ye();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},b("Loaded sample diff."),n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:J(e.left.content,e.right.content),history:null})}async function D(r){let[s,d]=r,[c,g]=await Promise.all([s.text(),d.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:s.name,content:c},e.right={name:d.name,content:g},b(`Loaded ${s.name} and ${d.name}.`),n({type:"showDiff",file1:s.name,file2:d.name,comparisonId:`web-${e.comparisonId}`,leftContent:c,rightContent:g,diffModel:J(c,g),history:null})}async function R(r){let s=await Promise.all(r.map(async(d,c)=>{let g=await d.text();return{id:`web-panel-${c}`,label:d.name,content:g,savedContent:g,dirty:!1,editable:!0}}));e.mode="multi-diff",b(`Loaded ${s.length}-panel diff for ${s.map(d=>d.label).join(", ")}.`),n({type:"showMultiDiff",panels:s,pairs:s.slice(0,-1).map((d,c)=>({leftIndex:c,rightIndex:c+1,diffModel:J(d.content,s[c+1].content)}))})}function b(r){let s=document.getElementById("web-status");s&&(s.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
