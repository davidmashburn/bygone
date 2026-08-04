"use strict";(()=>{function H(){}H.prototype={diff:function(e,n){var o,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},s=a.callback;typeof a=="function"&&(s=a,a={}),this.options=a;var d=this;function f(v){return s?(setTimeout(function(){s(void 0,v)},0),!0):v}e=this.castInput(e),n=this.castInput(n),e=this.removeEmpty(this.tokenize(e)),n=this.removeEmpty(this.tokenize(n));var h=n.length,g=e.length,u=1,p=h+g;a.maxEditLength&&(p=Math.min(p,a.maxEditLength));var y=(o=a.timeout)!==null&&o!==void 0?o:1/0,S=Date.now()+y,I=[{oldPos:-1,lastComponent:void 0}],$=this.extractCommon(I[0],n,e,0);if(I[0].oldPos+1>=g&&$+1>=h)return f([{value:this.join(n),count:n.length}]);var x=-1/0,F=1/0;function D(){for(var v=Math.max(x,-u);v<=Math.min(F,u);v+=2){var L=void 0,r=I[v-1],i=I[v+1];r&&(I[v-1]=void 0);var c=!1;if(i){var l=i.oldPos-v;c=i&&0<=l&&l<h}var m=r&&r.oldPos+1<g;if(!c&&!m){I[v]=void 0;continue}if(!m||c&&r.oldPos+1<i.oldPos?L=d.addToPath(i,!0,void 0,0):L=d.addToPath(r,void 0,!0,1),$=d.extractCommon(L,n,e,v),L.oldPos+1>=g&&$+1>=h)return f(Le(d,L.lastComponent,n,e,d.useLongestToken));I[v]=L,L.oldPos+1>=g&&(F=Math.min(F,v-1)),$+1>=h&&(x=Math.max(x,v+1))}u++}if(s)(function v(){setTimeout(function(){if(u>p||Date.now()>S)return s();D()||v()},0)})();else for(;u<=p&&Date.now()<=S;){var q=D();if(q)return q}},addToPath:function(e,n,o,a){var s=e.lastComponent;return s&&s.added===n&&s.removed===o?{oldPos:e.oldPos+a,lastComponent:{count:s.count+1,added:n,removed:o,previousComponent:s.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:n,removed:o,previousComponent:s}}},extractCommon:function(e,n,o,a){for(var s=n.length,d=o.length,f=e.oldPos,h=f-a,g=0;h+1<s&&f+1<d&&this.equals(n[h+1],o[f+1]);)h++,f++,g++;return g&&(e.lastComponent={count:g,previousComponent:e.lastComponent}),e.oldPos=f,h},equals:function(e,n){return this.options.comparator?this.options.comparator(e,n):e===n||this.options.ignoreCase&&e.toLowerCase()===n.toLowerCase()},removeEmpty:function(e){for(var n=[],o=0;o<e.length;o++)e[o]&&n.push(e[o]);return n},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function Le(t,e,n,o,a){for(var s=[],d;e;)s.push(e),d=e.previousComponent,delete e.previousComponent,e=d;s.reverse();for(var f=0,h=s.length,g=0,u=0;f<h;f++){var p=s[f];if(p.removed){if(p.value=t.join(o.slice(u,u+p.count)),u+=p.count,f&&s[f-1].added){var S=s[f-1];s[f-1]=s[f],s[f]=S}}else{if(!p.added&&a){var y=n.slice(g,g+p.count);y=y.map(function($,x){var F=o[u+x];return F.length>$.length?F:$}),p.value=t.join(y)}else p.value=t.join(n.slice(g,g+p.count));g+=p.count,p.added||(u+=p.count)}}var I=s[h-1];return h>1&&typeof I.value=="string"&&(I.added||I.removed)&&t.equals("",I.value)&&(s[h-2].value+=I.value,s.pop()),s}var Ie=new H;function ce(t,e,n){return Ie.diff(t,e,n)}var ae=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,le=/\S/,ie=new H;ie.equals=function(t,e){return this.options.ignoreCase&&(t=t.toLowerCase(),e=e.toLowerCase()),t===e||this.options.ignoreWhitespace&&!le.test(t)&&!le.test(e)};ie.tokenize=function(t){for(var e=t.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),n=0;n<e.length-1;n++)!e[n+1]&&e[n+2]&&ae.test(e[n])&&ae.test(e[n+2])&&(e[n]+=e[n+2],e.splice(n+1,2),n--);return e};function fe(t,e,n){return ie.diff(t,e,n)}var de=new H;de.tokenize=function(t){this.options.stripTrailingCr&&(t=t.replace(/\r\n/g,`
`));var e=[],n=t.split(/(\n|\r\n)/);n[n.length-1]||n.pop();for(var o=0;o<n.length;o++){var a=n[o];o%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var be=new H;be.tokenize=function(t){return t.split(/(\S.+?[.!?])(?=\s+|$)/)};var Ce=new H;Ce.tokenize=function(t){return t.split(/([{}:;,]|\s+)/)};function J(t){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?J=function(e){return typeof e}:J=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},J(t)}var Se=Object.prototype.toString,_=new H;_.useLongestToken=!0;_.tokenize=de.tokenize;_.castInput=function(t){var e=this.options,n=e.undefinedReplacement,o=e.stringifyReplacer,a=o===void 0?function(s,d){return typeof d>"u"?n:d}:o;return typeof t=="string"?t:JSON.stringify(re(t,null,null,a),a,"  ")};_.equals=function(t,e){return H.prototype.equals.call(_,t.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function re(t,e,n,o,a){e=e||[],n=n||[],o&&(t=o(a,t));var s;for(s=0;s<e.length;s+=1)if(e[s]===t)return n[s];var d;if(Se.call(t)==="[object Array]"){for(e.push(t),d=new Array(t.length),n.push(d),s=0;s<t.length;s+=1)d[s]=re(t[s],e,n,o,a);return e.pop(),n.pop(),d}if(t&&t.toJSON&&(t=t.toJSON()),J(t)==="object"&&t!==null){e.push(t),d={},n.push(d);var f=[],h;for(h in t)t.hasOwnProperty(h)&&f.push(h);for(f.sort(),s=0;s<f.length;s+=1)h=f[s],d[h]=re(t[h],e,n,o,h);e.pop(),n.pop()}else d=t;return d}var V=new H;V.tokenize=function(t){return t.slice()};V.join=V.removeEmpty=function(t){return t};function ue(t,e,n){return V.diff(t,e,n)}var Ne=500,he=ke("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",Ne);function K(t,e){let n=me(t),o=me(e),a=ue(n,o),s=[],d=[],f=[],h=[],g=1,u=1;for(let y=0;y<a.length;y++){let S=a[y],I=S.removed?S.value:[],$=S.added?S.value:[];if(!S.added&&!S.removed){for(let x of S.value)d.push(z("context",x,g)),f.push(z("context",x,u)),s.push(X(j("context",x,g++),j("context",x,u++)));continue}if(S.removed&&y+1<a.length&&a[y+1].added){let x=a[y+1],F=d.length,D=f.length,q=Te(I,x.value);for(let{left:v,right:L}of q){let r,i;v!==void 0&&(r=z("removed",v,g),d.push(r)),L!==void 0&&(i=z("added",L,u),f.push(i)),r&&i&&De(r,i),s.push(X(v===void 0?Y():j("removed",v,g++),L===void 0?Y():j("added",L,u++)))}h.push(oe("replace",F,d.length,D,f.length)),y++;continue}if(S.removed){let x=d.length,F=f.length;for(let D of I)d.push(z("removed",D,g)),s.push(X(j("removed",D,g++),Y()));h.push(oe("delete",x,d.length,F,f.length));continue}if(S.added){let x=d.length,F=f.length;for(let D of $)f.push(z("added",D,u)),s.push(X(Y(),j("added",D,u++)));h.push(oe("insert",x,d.length,F,f.length))}}let p=s.some(y=>y.left.kind!=="context"||y.right.kind!=="context");return{rows:s,leftLines:d,rightLines:f,blocks:h,hasChanges:p}}function me(t){if(t.length===0)return[];let e=t.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function Te(t,e){if(t.length*e.length>1e4)return $e(t,e);let o=0,a=.45,s=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),d=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(null));s[0][0]=0;for(let u=1;u<=t.length;u++)s[u][0]=s[u-1][0]+o,d[u][0]="left";for(let u=1;u<=e.length;u++)s[0][u]=s[0][u-1]+o,d[0][u]="right";for(let u=1;u<=t.length;u++)for(let p=1;p<=e.length;p++){let y=Fe(t[u-1],e[p-1]),I=[{move:"match",score:y>a?s[u-1][p-1]+Math.pow(y-a,2):Number.NEGATIVE_INFINITY},{move:"left",score:s[u-1][p]+o},{move:"right",score:s[u][p-1]+o}].reduce(($,x)=>x.score>$.score?x:$);s[u][p]=I.score,d[u][p]=I.move}let f=[],h=t.length,g=e.length;for(;h>0||g>0;){let u=d[h][g];u==="match"?f.push({left:t[--h],right:e[--g]}):u==="left"?f.push({left:t[--h]}):f.push({right:e[--g]})}return f.reverse()}function $e(t,e){let n=Math.max(t.length,e.length);return Array.from({length:n},(o,a)=>({left:t[a],right:e[a]}))}function Fe(t,e){let n=t.length+e.length;return n===0?1:2*ce(t,e).filter(a=>!a.added&&!a.removed).reduce((a,s)=>a+s.value.length,0)/n}function De(t,e){if(t.content.length>he||e.content.length>he)return;let{leftSegments:n,rightSegments:o,hasInlineChanges:a}=Ae(t.content,e.content);a&&(t.segments=n,e.segments=o)}function Ae(t,e){let n=fe(t,e),o=[],a=[],s=!1;for(let d of n){let f=d.value;if(!d.added&&!d.removed){let g={kind:"context",text:f,emphasis:!1};o.push(g),a.push(g);continue}let h=/[^\s]/.test(f);s=s||h,d.removed&&o.push({kind:"removed",text:f,emphasis:h}),d.added&&a.push({kind:"added",text:f,emphasis:h})}return{leftSegments:o,rightSegments:a,hasInlineChanges:s}}function Y(){return{kind:"placeholder",content:"",lineNumber:null}}function j(t,e,n){return{kind:t,content:e,lineNumber:n}}function z(t,e,n){return{kind:t,content:e,lineNumber:n}}function X(t,e){return{left:t,right:e}}function oe(t,e,n,o,a){return{kind:t,leftStart:e,leftEnd:n,rightStart:o,rightEnd:a}}function ke(t,e){let n=typeof process<"u"?process.env?.[t]:void 0,o=Number.parseInt(n??"",10);return Number.isFinite(o)&&o>0?o:e}function ge(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}function we(t){if(!O(t)||t.version!==1)throw new Error("Unsupported or missing change-tour manifest version.");if(T(t.title,"title"),T(t.generatedAt,"generatedAt"),t.sourceUrl!==void 0&&T(t.sourceUrl,"sourceUrl"),!O(t.range))throw new Error("Change-tour manifest range must be an object.");for(let n of["baseRef","headRef","mergeBaseOid","headOid"])T(t.range[n],`range.${n}`);if(!O(t.summary))throw new Error("Change-tour manifest summary must be an object.");for(let n of["changedFiles","includedScenes","additions","deletions","commitCount"])Z(t.summary[n],`summary.${n}`);if(Q(t.summary.omittedFiles,"summary.omittedFiles"),!Array.isArray(t.commits)||!Array.isArray(t.chapters)||!Array.isArray(t.scenes))throw new Error("Change-tour manifest commits, chapters, and scenes must be arrays.");let e=new Set;for(let[n,o]of t.scenes.entries()){if(ye(o,n),e.has(o.id))throw new Error(`Duplicate change-tour scene id: ${o.id}`);e.add(o.id)}for(let[n,o]of t.chapters.entries()){if(!O(o))throw new Error(`chapters[${n}] must be an object.`);T(o.id,`chapters[${n}].id`),T(o.title,`chapters[${n}].title`),Q(o.sceneIds,`chapters[${n}].sceneIds`);for(let a of o.sceneIds)if(!e.has(a))throw new Error(`Chapter references unknown scene id: ${a}`)}if(t.summary.includedScenes!==t.scenes.length)throw new Error("summary.includedScenes must match the number of scenes.");return t}function ye(t,e){if(!O(t)||!["text-diff","discussion","walkthrough"].includes(String(t.kind)))throw new Error(`scenes[${e}] must be a text-diff, discussion, or walkthrough scene.`);for(let n of["id","title"])T(t[n],`scenes[${e}].${n}`);if(Oe(t,`scenes[${e}]`),t.kind!=="discussion"){if(t.kind==="walkthrough"){if(!Array.isArray(t.steps)||t.steps.length===0)throw new Error(`scenes[${e}].steps must be a non-empty array.`);for(let[n,o]of t.steps.entries()){let a=`scenes[${e}].steps[${n}]`;if(!O(o)||!O(o.focus)||!O(o.diff))throw new Error(`${a} must contain focus and diff objects.`);for(let s of["id","title","body"])T(o[s],`${a}.${s}`);if(se(o.focus,`${a}.focus`),ye(o.diff,e),o.diff.kind!=="text-diff")throw new Error(`${a}.diff must be a text-diff scene.`);if(o.connection!==void 0){if(!O(o.connection))throw new Error(`${a}.connection must be an object.`);T(o.connection.id,`${a}.connection.id`),T(o.connection.label,`${a}.connection.label`),se(o.connection.from,`${a}.connection.from`),se(o.connection.to,`${a}.connection.to`)}}return}for(let n of["path","leftLabel","rightLabel","leftContent","rightContent"])T(t[n],`scenes[${e}].${n}`);t.previousPath!==void 0&&T(t.previousPath,`scenes[${e}].previousPath`),T(t.changeKind,`scenes[${e}].changeKind`),Z(t.additions,`scenes[${e}].additions`),Z(t.deletions,`scenes[${e}].deletions`),t.focusChangeIndex!==void 0&&Z(t.focusChangeIndex,`scenes[${e}].focusChangeIndex`)}}function se(t,e){if(!O(t))throw new Error(`${e} must be an object.`);for(let n of["id","path","revision","excerpt"])T(t[n],`${e}.${n}`);if(t.revision!=="base"&&t.revision!=="head")throw new Error(`${e}.revision must be base or head.`);if(pe(t.startLine,`${e}.startLine`),pe(t.endLine,`${e}.endLine`),Number(t.endLine)<Number(t.startLine))throw new Error(`${e}.endLine must not precede startLine.`)}function Oe(t,e){T(t.summary,`${e}.summary`),Q(t.bullets,`${e}.bullets`),Q(t.tags,`${e}.tags`),T(t.takeaway,`${e}.takeaway`)}function O(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function T(t,e){if(typeof t!="string")throw new Error(`${e} must be a string.`)}function Q(t,e){if(!Array.isArray(t)||t.some(n=>typeof n!="string"))throw new Error(`${e} must be an array of strings.`)}function Z(t,e){if(!Number.isInteger(t)||Number(t)<0)throw new Error(`${e} must be a non-negative integer.`)}function pe(t,e){if(!Number.isInteger(t)||Number(t)<1)throw new Error(`${e} must be a positive integer.`)}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0,tour:null,activeSceneIndex:-1,activeStepIndex:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){o(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),L("Browser host ready.")});function n(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function o(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){let i=new URLSearchParams(window.location.search),c=i.get("manifest");c?s(c):i.get("demo")==="1"&&D();return}if(r.type==="navigateFile"&&e.mode==="tour"){f(e.activeSceneIndex+(r.direction==="previous"?-1:1));return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:K(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),i=document.getElementById("web-open-diff"),c=document.getElementById("web-open-diff3"),l=document.getElementById("web-diff-input"),m=document.getElementById("web-diff3-input"),E=document.getElementById("tour-previous"),C=document.getElementById("tour-next");r?.addEventListener("click",()=>{D()}),i?.addEventListener("click",()=>{l.value="",l.click()}),c?.addEventListener("click",()=>{m.value="",m.click()}),l?.addEventListener("change",async()=>{let w=Array.from(l.files||[]);if(w.length!==2){L("Select exactly 2 files for a diff.");return}await q(w)}),m?.addEventListener("change",async()=>{let w=Array.from(m.files||[]);if(w.length<1){L("Select one or more files.");return}await v(w)}),E?.addEventListener("click",()=>y(-1)),C?.addEventListener("click",()=>y(1)),window.addEventListener("keydown",w=>{e.mode!=="tour"||w.metaKey||w.ctrlKey||w.altKey||(w.key==="PageUp"||w.key==="ArrowLeft"?(w.preventDefault(),y(-1)):(w.key==="PageDown"||w.key==="ArrowRight")&&(w.preventDefault(),y(1)))})}async function s(r){L("Loading change tour\u2026");try{let i=await fetch(r,{cache:"no-store"});if(!i.ok)throw new Error(`Manifest request failed (${i.status}).`);e.tour=we(await i.json()),e.mode="tour",document.body.classList.add("tour-mode"),d();let c=new URLSearchParams(window.location.search).get("scene"),l=e.tour.scenes.findIndex(m=>m.id===c);f(l>=0?l:0),L("")}catch(i){L(`Could not load change tour: ${i instanceof Error?i.message:String(i)}`)}}function d(){let r=e.tour;if(!r)return;let i=document.getElementById("tour-shell"),c=document.getElementById("tour-title"),l=document.getElementById("tour-source"),m=document.getElementById("tour-range"),E=document.getElementById("tour-stats"),C=document.getElementById("tour-scenes"),w=document.getElementById("tour-commits"),M=document.getElementById("tour-commits-summary");if(!i||!c||!l||!m||!E||!C||!w||!M)throw new Error("Presenter UI is incomplete.");i.hidden=!1,c.textContent=r.title,r.sourceUrl?(l.href=r.sourceUrl,l.hidden=!1):l.hidden=!0;let P=x(r.range.baseRef),A=x(r.range.headRef),W=r.range.headOid.slice(0,7);m.textContent=`${P} \u2192 ${A}${A===W?"":` \xB7 ${W}`}`,E.textContent=`${r.summary.changedFiles} files \xB7 +${r.summary.additions} \u2212${r.summary.deletions} \xB7 ${r.summary.commitCount} commits`,M.textContent=`${r.summary.commitCount} commits`,C.replaceChildren();let U=new Map(r.scenes.map(N=>[N.id,N]));for(let N of r.chapters){let R=document.createElement("h2");R.className="tour-chapter-title",R.textContent=N.title,C.append(R);for(let B of N.sceneIds){let b=U.get(B);if(!b)continue;let G=r.scenes.indexOf(b),k=document.createElement("button");k.type="button",k.className="tour-scene",k.dataset.sceneId=b.id,k.title=b.kind==="text-diff"?b.path:b.title,k.addEventListener("click",()=>f(G));let ee=document.createElement("span");ee.className="tour-scene-number",ee.textContent=String(G+1).padStart(2,"0");let te=document.createElement("span");te.className="tour-scene-copy";for(let[ve,xe]of[["tour-scene-title",b.title],["tour-scene-path",b.kind==="text-diff"?b.path:b.kind==="walkthrough"?`${b.steps.length} code steps`:"Discussion"],["tour-scene-note",b.takeaway]]){let ne=document.createElement("span");ne.className=ve,ne.textContent=xe,te.append(ne)}k.append(ee,te),C.append(k)}}w.replaceChildren(...r.commits.map(N=>{let R=document.createElement("li"),B=document.createElement("span");return B.className="tour-commit-oid",B.textContent=N.shortOid,R.append(B,document.createTextNode(N.summary)),R}))}function f(r,i=0){let c=e.tour;if(!c||r<0||r>=c.scenes.length)return;let l=c.scenes[r];e.activeSceneIndex=r,e.activeStepIndex=l.kind==="walkthrough"?Math.min(Math.max(i,0),Math.max(l.steps.length-1,0)):0;let m=S(c,r);document.querySelectorAll(".tour-scene").forEach(C=>{C.classList.toggle("is-active",C.dataset.sceneId===l.id)}),document.querySelector(`.tour-scene[data-scene-id="${l.id}"]`)?.scrollIntoView({block:"nearest"}),F(l,m);let E=new URLSearchParams(window.location.search);if(E.set("scene",l.id),window.history.replaceState(null,"",`${window.location.pathname}?${E.toString()}`),l.kind==="discussion"){document.body.classList.add("tour-discussion");return}if(document.body.classList.remove("tour-discussion"),l.kind==="walkthrough"){u(l);return}h(l,r)}function h(r,i,c=null,l=r.id){let m=e.tour;if(!m)return;let E=K(r.leftContent,r.rightContent),C=g(r,r.leftLabel,"base"),w=g(r,r.rightLabel,"head");n({type:"showDiff",file1:C,file2:w,comparisonId:`tour-${l}`,leftContent:r.leftContent,rightContent:r.rightContent,diffModel:E,history:null,fileNavigation:{canGoPrevious:i>0,canGoNext:i<m.scenes.length-1},editableSides:{left:!1,right:!1},comparisonSummary:`${r.path} \xB7 ${r.takeaway}`,initialChangeIndex:c?$(E,c.side,c.startLine):r.focusChangeIndex,tourAnnotation:c})}function g(r,i,c){let l=i.startsWith(r.path)?i.slice(r.path.length).trim():i.trim();return l?`${c} ${l}`:c}function u(r){let i=r.steps[e.activeStepIndex];if(!i)return;let c=i.focus.revision==="base"?"left":"right";h(i.diff,e.activeSceneIndex,{side:c,startLine:i.focus.startLine,endLine:i.focus.endLine,label:`${i.title}: ${i.body}`},`${r.id}-${i.id}`)}function p(r){let i=e.tour,c=i?.scenes[e.activeSceneIndex];if(!i||!c||r===0)return null;if(r>0)return c.kind==="walkthrough"&&e.activeStepIndex<c.steps.length-1?{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex+1}:e.activeSceneIndex<i.scenes.length-1?{sceneIndex:e.activeSceneIndex+1,stepIndex:0}:null;if(c.kind==="walkthrough"&&e.activeStepIndex>0)return{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex-1};if(e.activeSceneIndex>0){let l=i.scenes[e.activeSceneIndex-1];return{sceneIndex:e.activeSceneIndex-1,stepIndex:l.kind==="walkthrough"?l.steps.length-1:0}}return null}function y(r){let i=p(r);return i?(f(i.sceneIndex,i.stepIndex),!0):!1}function S(r,i){let c=r.scenes[i],l=r.chapters.findIndex(w=>w.sceneIds.includes(c.id)),m=l>=0?r.chapters[l]:null,E=m?m.sceneIds.indexOf(c.id)+1:i+1,C=m?m.sceneIds.length:r.scenes.length;return{chapter:m,chapterIndex:l,chapterNumber:l>=0?l+1:i+1,sceneInChapter:E,scenesInChapter:C}}function I(r,i,c){let l=[`Ch ${r.chapterNumber}`,`Scene ${r.sceneInChapter}/${r.scenesInChapter}`];return i.kind==="walkthrough"&&l.push(`Step ${c+1}/${i.steps.length}`),l.join(" \xB7 ")}function $(r,i,c){let m=(i==="left"?r.leftLines:r.rightLines).findIndex(A=>A.lineNumber===c);if(m<0)return 0;let E=i==="left"?"leftStart":"rightStart",C=i==="left"?"leftEnd":"rightEnd",w=r.blocks.findIndex(A=>m>=A[E]&&m<A[C]);if(w>=0)return w;let M=0,P=Number.POSITIVE_INFINITY;return r.blocks.forEach((A,W)=>{let U=Math.min(Math.abs(m-A[E]),Math.abs(m-A[C]));U<P&&(M=W,P=U)}),M}function x(r){return/^[0-9a-f]{40}$/i.test(r)?r.slice(0,7):r}function F(r,i){let c=document.getElementById("tour-narrative"),l=document.getElementById("tour-breadcrumb"),m=document.getElementById("tour-narrative-chapter"),E=document.getElementById("tour-narrative-title"),C=document.getElementById("tour-narrative-summary"),w=document.getElementById("tour-narrative-bullets"),M=document.getElementById("tour-narrative-tags"),P=document.getElementById("tour-narrative-takeaway"),A=document.getElementById("tour-step"),W=document.getElementById("tour-step-title"),U=document.getElementById("tour-step-body"),N=document.getElementById("tour-connection"),R=document.getElementById("tour-previous"),B=document.getElementById("tour-next");if(!c||!l||!m||!E||!C||!w||!M||!P||!A||!W||!U||!N||!R||!B)throw new Error("Tour narrative UI is incomplete.");c.hidden=!1,l.textContent=I(i,r,e.activeStepIndex),m.textContent=i.chapter?.title||"Change tour",E.textContent=r.title,C.textContent=r.summary,w.replaceChildren(...r.bullets.map(G=>{let k=document.createElement("li");return k.textContent=G,k})),M.replaceChildren(...r.tags.map(G=>{let k=document.createElement("span");return k.textContent=G,k})),P.textContent=r.takeaway;let b=r.kind==="walkthrough"?r.steps[e.activeStepIndex]:null;A.hidden=!b,b?(W.textContent=b.title,U.textContent=b.body,b.connection?(N.hidden=!1,N.textContent=`${b.connection.from.path} \u2192 ${b.connection.to.path} \xB7 ${b.connection.label}`):(N.hidden=!0,N.textContent="")):(N.hidden=!0,N.textContent=""),R.disabled=!p(-1),B.disabled=!p(1)}function D(){let r=ge();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},L("Loaded sample diff."),n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:K(e.left.content,e.right.content),history:null})}async function q(r){let[i,c]=r,[l,m]=await Promise.all([i.text(),c.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:i.name,content:l},e.right={name:c.name,content:m},L(`Loaded ${i.name} and ${c.name}.`),n({type:"showDiff",file1:i.name,file2:c.name,comparisonId:`web-${e.comparisonId}`,leftContent:l,rightContent:m,diffModel:K(l,m),history:null})}async function v(r){let i=await Promise.all(r.map(async(c,l)=>{let m=await c.text();return{id:`web-panel-${l}`,label:c.name,content:m,savedContent:m,dirty:!1,editable:!0}}));e.mode="multi-diff",L(`Loaded ${i.length}-panel diff for ${i.map(c=>c.label).join(", ")}.`),n({type:"showMultiDiff",panels:i,pairs:i.slice(0,-1).map((c,l)=>({leftIndex:l,rightIndex:l+1,diffModel:K(c.content,i[l+1].content)}))})}function L(r){let i=document.getElementById("web-status");i&&(i.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
