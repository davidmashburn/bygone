"use strict";(()=>{function P(){}P.prototype={diff:function(e,n){var o,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},s=a.callback;typeof a=="function"&&(s=a,a={}),this.options=a;var d=this;function c(g){return s?(setTimeout(function(){s(void 0,g)},0),!0):g}e=this.castInput(e),n=this.castInput(n),e=this.removeEmpty(this.tokenize(e)),n=this.removeEmpty(this.tokenize(n));var u=n.length,m=e.length,f=1,y=u+m;a.maxEditLength&&(y=Math.min(y,a.maxEditLength));var b=(o=a.timeout)!==null&&o!==void 0?o:1/0,C=Date.now()+b,I=[{oldPos:-1,lastComponent:void 0}],$=this.extractCommon(I[0],n,e,0);if(I[0].oldPos+1>=m&&$+1>=u)return c([{value:this.join(n),count:n.length}]);var L=-1/0,F=1/0;function B(){for(var g=Math.max(L,-f);g<=Math.min(F,f);g+=2){var r=void 0,i=I[g-1],l=I[g+1];i&&(I[g-1]=void 0);var h=!1;if(l){var p=l.oldPos-g;h=l&&0<=p&&p<u}var v=i&&i.oldPos+1<m;if(!h&&!v){I[g]=void 0;continue}if(!v||h&&i.oldPos+1<l.oldPos?r=d.addToPath(l,!0,void 0,0):r=d.addToPath(i,void 0,!0,1),$=d.extractCommon(r,n,e,g),r.oldPos+1>=m&&$+1>=u)return c(xe(d,r.lastComponent,n,e,d.useLongestToken));I[g]=r,r.oldPos+1>=m&&(F=Math.min(F,g-1)),$+1>=u&&(L=Math.max(L,g+1))}f++}if(s)(function g(){setTimeout(function(){if(f>y||Date.now()>C)return s();B()||g()},0)})();else for(;f<=y&&Date.now()<=C;){var U=B();if(U)return U}},addToPath:function(e,n,o,a){var s=e.lastComponent;return s&&s.added===n&&s.removed===o?{oldPos:e.oldPos+a,lastComponent:{count:s.count+1,added:n,removed:o,previousComponent:s.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:n,removed:o,previousComponent:s}}},extractCommon:function(e,n,o,a){for(var s=n.length,d=o.length,c=e.oldPos,u=c-a,m=0;u+1<s&&c+1<d&&this.equals(n[u+1],o[c+1]);)u++,c++,m++;return m&&(e.lastComponent={count:m,previousComponent:e.lastComponent}),e.oldPos=c,u},equals:function(e,n){return this.options.comparator?this.options.comparator(e,n):e===n||this.options.ignoreCase&&e.toLowerCase()===n.toLowerCase()},removeEmpty:function(e){for(var n=[],o=0;o<e.length;o++)e[o]&&n.push(e[o]);return n},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function xe(t,e,n,o,a){for(var s=[],d;e;)s.push(e),d=e.previousComponent,delete e.previousComponent,e=d;s.reverse();for(var c=0,u=s.length,m=0,f=0;c<u;c++){var y=s[c];if(y.removed){if(y.value=t.join(o.slice(f,f+y.count)),f+=y.count,c&&s[c-1].added){var C=s[c-1];s[c-1]=s[c],s[c]=C}}else{if(!y.added&&a){var b=n.slice(m,m+y.count);b=b.map(function($,L){var F=o[f+L];return F.length>$.length?F:$}),y.value=t.join(b)}else y.value=t.join(n.slice(m,m+y.count));m+=y.count,y.added||(f+=y.count)}}var I=s[u-1];return u>1&&typeof I.value=="string"&&(I.added||I.removed)&&t.equals("",I.value)&&(s[u-2].value+=I.value,s.pop()),s}var Ie=new P;function le(t,e,n){return Ie.diff(t,e,n)}var se=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,ae=/\S/,re=new P;re.equals=function(t,e){return this.options.ignoreCase&&(t=t.toLowerCase(),e=e.toLowerCase()),t===e||this.options.ignoreWhitespace&&!ae.test(t)&&!ae.test(e)};re.tokenize=function(t){for(var e=t.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),n=0;n<e.length-1;n++)!e[n+1]&&e[n+2]&&se.test(e[n])&&se.test(e[n+2])&&(e[n]+=e[n+2],e.splice(n+1,2),n--);return e};function ce(t,e,n){return re.diff(t,e,n)}var de=new P;de.tokenize=function(t){this.options.stripTrailingCr&&(t=t.replace(/\r\n/g,`
`));var e=[],n=t.split(/(\n|\r\n)/);n[n.length-1]||n.pop();for(var o=0;o<n.length;o++){var a=n[o];o%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var Le=new P;Le.tokenize=function(t){return t.split(/(\S.+?[.!?])(?=\s+|$)/)};var be=new P;be.tokenize=function(t){return t.split(/([{}:;,]|\s+)/)};function K(t){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?K=function(e){return typeof e}:K=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},K(t)}var Ce=Object.prototype.toString,J=new P;J.useLongestToken=!0;J.tokenize=de.tokenize;J.castInput=function(t){var e=this.options,n=e.undefinedReplacement,o=e.stringifyReplacer,a=o===void 0?function(s,d){return typeof d>"u"?n:d}:o;return typeof t=="string"?t:JSON.stringify(ne(t,null,null,a),a,"  ")};J.equals=function(t,e){return P.prototype.equals.call(J,t.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function ne(t,e,n,o,a){e=e||[],n=n||[],o&&(t=o(a,t));var s;for(s=0;s<e.length;s+=1)if(e[s]===t)return n[s];var d;if(Ce.call(t)==="[object Array]"){for(e.push(t),d=new Array(t.length),n.push(d),s=0;s<t.length;s+=1)d[s]=ne(t[s],e,n,o,a);return e.pop(),n.pop(),d}if(t&&t.toJSON&&(t=t.toJSON()),K(t)==="object"&&t!==null){e.push(t),d={},n.push(d);var c=[],u;for(u in t)t.hasOwnProperty(u)&&c.push(u);for(c.sort(),s=0;s<c.length;s+=1)u=c[s],d[u]=ne(t[u],e,n,o,u);e.pop(),n.pop()}else d=t;return d}var _=new P;_.tokenize=function(t){return t.slice()};_.join=_.removeEmpty=function(t){return t};function fe(t,e,n){return _.diff(t,e,n)}var Se=500,ue=Ae("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",Se);function z(t,e){let n=he(t),o=he(e),a=fe(n,o),s=[],d=[],c=[],u=[],m=1,f=1;for(let b=0;b<a.length;b++){let C=a[b],I=C.removed?C.value:[],$=C.added?C.value:[];if(!C.added&&!C.removed){for(let L of C.value)d.push(j("context",L,m)),c.push(j("context",L,f)),s.push(Y(G("context",L,m++),G("context",L,f++)));continue}if(C.removed&&b+1<a.length&&a[b+1].added){let L=a[b+1],F=d.length,B=c.length,U=Ne(I,L.value);for(let{left:g,right:r}of U){let i,l;g!==void 0&&(i=j("removed",g,m),d.push(i)),r!==void 0&&(l=j("added",r,f),c.push(l)),i&&l&&Fe(i,l),s.push(Y(g===void 0?V():G("removed",g,m++),r===void 0?V():G("added",r,f++)))}u.push(ie("replace",F,d.length,B,c.length)),b++;continue}if(C.removed){let L=d.length,F=c.length;for(let B of I)d.push(j("removed",B,m)),s.push(Y(G("removed",B,m++),V()));u.push(ie("delete",L,d.length,F,c.length));continue}if(C.added){let L=d.length,F=c.length;for(let B of $)c.push(j("added",B,f)),s.push(Y(V(),G("added",B,f++)));u.push(ie("insert",L,d.length,F,c.length))}}let y=s.some(b=>b.left.kind!=="context"||b.right.kind!=="context");return{rows:s,leftLines:d,rightLines:c,blocks:u,hasChanges:y}}function he(t){if(t.length===0)return[];let e=t.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function Ne(t,e){if(t.length*e.length>1e4)return Te(t,e);let o=0,a=.45,s=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),d=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(null));s[0][0]=0;for(let f=1;f<=t.length;f++)s[f][0]=s[f-1][0]+o,d[f][0]="left";for(let f=1;f<=e.length;f++)s[0][f]=s[0][f-1]+o,d[0][f]="right";for(let f=1;f<=t.length;f++)for(let y=1;y<=e.length;y++){let b=$e(t[f-1],e[y-1]),I=[{move:"match",score:b>a?s[f-1][y-1]+Math.pow(b-a,2):Number.NEGATIVE_INFINITY},{move:"left",score:s[f-1][y]+o},{move:"right",score:s[f][y-1]+o}].reduce(($,L)=>L.score>$.score?L:$);s[f][y]=I.score,d[f][y]=I.move}let c=[],u=t.length,m=e.length;for(;u>0||m>0;){let f=d[u][m];f==="match"?c.push({left:t[--u],right:e[--m]}):f==="left"?c.push({left:t[--u]}):c.push({right:e[--m]})}return c.reverse()}function Te(t,e){let n=Math.max(t.length,e.length);return Array.from({length:n},(o,a)=>({left:t[a],right:e[a]}))}function $e(t,e){let n=t.length+e.length;return n===0?1:2*le(t,e).filter(a=>!a.added&&!a.removed).reduce((a,s)=>a+s.value.length,0)/n}function Fe(t,e){if(t.content.length>ue||e.content.length>ue)return;let{leftSegments:n,rightSegments:o,hasInlineChanges:a}=De(t.content,e.content);a&&(t.segments=n,e.segments=o)}function De(t,e){let n=ce(t,e),o=[],a=[],s=!1;for(let d of n){let c=d.value;if(!d.added&&!d.removed){let m={kind:"context",text:c,emphasis:!1};o.push(m),a.push(m);continue}let u=/[^\s]/.test(c);s=s||u,d.removed&&o.push({kind:"removed",text:c,emphasis:u}),d.added&&a.push({kind:"added",text:c,emphasis:u})}return{leftSegments:o,rightSegments:a,hasInlineChanges:s}}function V(){return{kind:"placeholder",content:"",lineNumber:null}}function G(t,e,n){return{kind:t,content:e,lineNumber:n}}function j(t,e,n){return{kind:t,content:e,lineNumber:n}}function Y(t,e){return{left:t,right:e}}function ie(t,e,n,o,a){return{kind:t,leftStart:e,leftEnd:n,rightStart:o,rightEnd:a}}function Ae(t,e){let n=typeof process<"u"?process.env?.[t]:void 0,o=Number.parseInt(n??"",10);return Number.isFinite(o)&&o>0?o:e}function pe(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}function ge(t){if(!M(t)||t.version!==1)throw new Error("Unsupported or missing change-tour manifest version.");if(T(t.title,"title"),T(t.generatedAt,"generatedAt"),t.sourceUrl!==void 0&&T(t.sourceUrl,"sourceUrl"),!M(t.range))throw new Error("Change-tour manifest range must be an object.");for(let n of["baseRef","headRef","mergeBaseOid","headOid"])T(t.range[n],`range.${n}`);if(!M(t.summary))throw new Error("Change-tour manifest summary must be an object.");for(let n of["changedFiles","includedScenes","additions","deletions","commitCount"])X(t.summary[n],`summary.${n}`);if(Z(t.summary.omittedFiles,"summary.omittedFiles"),!Array.isArray(t.commits)||!Array.isArray(t.chapters)||!Array.isArray(t.scenes))throw new Error("Change-tour manifest commits, chapters, and scenes must be arrays.");let e=new Set;for(let[n,o]of t.scenes.entries()){if(ye(o,n),e.has(o.id))throw new Error(`Duplicate change-tour scene id: ${o.id}`);e.add(o.id)}for(let[n,o]of t.chapters.entries()){if(!M(o))throw new Error(`chapters[${n}] must be an object.`);T(o.id,`chapters[${n}].id`),T(o.title,`chapters[${n}].title`),Z(o.sceneIds,`chapters[${n}].sceneIds`);for(let a of o.sceneIds)if(!e.has(a))throw new Error(`Chapter references unknown scene id: ${a}`)}if(t.summary.includedScenes!==t.scenes.length)throw new Error("summary.includedScenes must match the number of scenes.");return t}function ye(t,e){if(!M(t)||!["text-diff","discussion","walkthrough"].includes(String(t.kind)))throw new Error(`scenes[${e}] must be a text-diff, discussion, or walkthrough scene.`);for(let n of["id","title"])T(t[n],`scenes[${e}].${n}`);if(ke(t,`scenes[${e}]`),t.kind!=="discussion"){if(t.kind==="walkthrough"){if(!Array.isArray(t.steps)||t.steps.length===0)throw new Error(`scenes[${e}].steps must be a non-empty array.`);for(let[n,o]of t.steps.entries()){let a=`scenes[${e}].steps[${n}]`;if(!M(o)||!M(o.focus)||!M(o.diff))throw new Error(`${a} must contain focus and diff objects.`);for(let s of["id","title","body"])T(o[s],`${a}.${s}`);if(oe(o.focus,`${a}.focus`),ye(o.diff,e),o.diff.kind!=="text-diff")throw new Error(`${a}.diff must be a text-diff scene.`);if(o.connection!==void 0){if(!M(o.connection))throw new Error(`${a}.connection must be an object.`);T(o.connection.id,`${a}.connection.id`),T(o.connection.label,`${a}.connection.label`),oe(o.connection.from,`${a}.connection.from`),oe(o.connection.to,`${a}.connection.to`)}}return}for(let n of["path","leftLabel","rightLabel","leftContent","rightContent"])T(t[n],`scenes[${e}].${n}`);t.previousPath!==void 0&&T(t.previousPath,`scenes[${e}].previousPath`),T(t.changeKind,`scenes[${e}].changeKind`),X(t.additions,`scenes[${e}].additions`),X(t.deletions,`scenes[${e}].deletions`),t.focusChangeIndex!==void 0&&X(t.focusChangeIndex,`scenes[${e}].focusChangeIndex`)}}function oe(t,e){if(!M(t))throw new Error(`${e} must be an object.`);for(let n of["id","path","revision","excerpt"])T(t[n],`${e}.${n}`);if(t.revision!=="base"&&t.revision!=="head")throw new Error(`${e}.revision must be base or head.`);if(me(t.startLine,`${e}.startLine`),me(t.endLine,`${e}.endLine`),Number(t.endLine)<Number(t.startLine))throw new Error(`${e}.endLine must not precede startLine.`)}function ke(t,e){T(t.summary,`${e}.summary`),Z(t.bullets,`${e}.bullets`),Z(t.tags,`${e}.tags`),T(t.takeaway,`${e}.takeaway`)}function M(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function T(t,e){if(typeof t!="string")throw new Error(`${e} must be a string.`)}function Z(t,e){if(!Array.isArray(t)||t.some(n=>typeof n!="string"))throw new Error(`${e} must be an array of strings.`)}function X(t,e){if(!Number.isInteger(t)||Number(t)<0)throw new Error(`${e} must be a non-negative integer.`)}function me(t,e){if(!Number.isInteger(t)||Number(t)<1)throw new Error(`${e} must be a positive integer.`)}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0,tour:null,activeSceneIndex:-1,activeStepIndex:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){o(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),g("Browser host ready.")});function n(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function o(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){let i=new URLSearchParams(window.location.search),l=i.get("manifest");l?s(l):i.get("demo")==="1"&&F();return}if(r.type==="navigateFile"&&e.mode==="tour"){c(e.activeSceneIndex+(r.direction==="previous"?-1:1));return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:z(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),i=document.getElementById("web-open-diff"),l=document.getElementById("web-open-diff3"),h=document.getElementById("web-diff-input"),p=document.getElementById("web-diff3-input"),v=document.getElementById("tour-previous"),k=document.getElementById("tour-next"),D=document.getElementById("tour-previous-chapter"),R=document.getElementById("tour-next-chapter"),H=document.getElementById("tour-step-previous"),E=document.getElementById("tour-step-next");r?.addEventListener("click",()=>{F()}),i?.addEventListener("click",()=>{h.value="",h.click()}),l?.addEventListener("click",()=>{p.value="",p.click()}),h?.addEventListener("change",async()=>{let w=Array.from(h.files||[]);if(w.length!==2){g("Select exactly 2 files for a diff.");return}await B(w)}),p?.addEventListener("change",async()=>{let w=Array.from(p.files||[]);if(w.length<1){g("Select one or more files.");return}await U(w)}),v?.addEventListener("click",()=>c(e.activeSceneIndex-1)),k?.addEventListener("click",()=>c(e.activeSceneIndex+1)),D?.addEventListener("click",()=>$(-1)),R?.addEventListener("click",()=>$(1)),H?.addEventListener("click",()=>f(-1)),E?.addEventListener("click",()=>f(1)),window.addEventListener("keydown",w=>{e.mode!=="tour"||w.metaKey||w.ctrlKey||w.altKey||(w.key==="PageUp"?(w.preventDefault(),f(-1)||c(e.activeSceneIndex-1)):w.key==="PageDown"&&(w.preventDefault(),f(1)||c(e.activeSceneIndex+1)))})}async function s(r){g("Loading change tour\u2026");try{let i=await fetch(r,{cache:"no-store"});if(!i.ok)throw new Error(`Manifest request failed (${i.status}).`);e.tour=ge(await i.json()),e.mode="tour",document.body.classList.add("tour-mode"),d();let l=new URLSearchParams(window.location.search).get("scene"),h=e.tour.scenes.findIndex(p=>p.id===l);c(h>=0?h:0),g("")}catch(i){g(`Could not load change tour: ${i instanceof Error?i.message:String(i)}`)}}function d(){let r=e.tour;if(!r)return;let i=document.getElementById("tour-shell"),l=document.getElementById("tour-title"),h=document.getElementById("tour-source"),p=document.getElementById("tour-range"),v=document.getElementById("tour-stats"),k=document.getElementById("tour-chapters"),D=document.getElementById("tour-scenes"),R=document.getElementById("tour-commits");if(!i||!l||!h||!p||!v||!k||!D||!R)throw new Error("Presenter UI is incomplete.");i.hidden=!1,l.textContent=r.title,r.sourceUrl&&(h.href=r.sourceUrl,h.hidden=!1);let H=C(r.range.baseRef),E=C(r.range.headRef),w=r.range.headOid.slice(0,7);p.textContent=`${H} \u2192 ${E}${E===w?"":` \xB7 ${w}`}`,v.textContent=`${r.summary.changedFiles} files \xB7 +${r.summary.additions} \u2212${r.summary.deletions} \xB7 ${r.summary.commitCount} commits`,k.replaceChildren(...r.chapters.map(S=>{let N=document.createElement("button");N.type="button",N.dataset.chapterId=S.id,N.title=`Jump to ${S.title}`,N.addEventListener("click",()=>I(S.id));let A=document.createElement("span");A.textContent=S.title;let x=document.createElement("span");return x.textContent=String(S.sceneIds.length),N.append(A,x),N})),D.replaceChildren();let W=new Map(r.scenes.map(S=>[S.id,S]));for(let S of r.chapters){let N=document.createElement("h2");N.className="tour-chapter-title",N.textContent=S.title,D.append(N);for(let A of S.sceneIds){let x=W.get(A);if(!x)continue;let q=r.scenes.indexOf(x),O=document.createElement("button");O.type="button",O.className="tour-scene",O.dataset.sceneId=x.id,O.title=x.kind==="text-diff"?x.path:x.title,O.addEventListener("click",()=>c(q));let Q=document.createElement("span");Q.className="tour-scene-number",Q.textContent=String(q+1).padStart(2,"0");let ee=document.createElement("span");ee.className="tour-scene-copy";for(let[we,ve]of[["tour-scene-title",x.title],["tour-scene-path",x.kind==="text-diff"?x.path:x.kind==="walkthrough"?`${x.steps.length} code steps`:"Discussion"],["tour-scene-note",x.takeaway]]){let te=document.createElement("span");te.className=we,te.textContent=ve,ee.append(te)}O.append(Q,ee),D.append(O)}}R.replaceChildren(...r.commits.map(S=>{let N=document.createElement("li"),A=document.createElement("span");return A.className="tour-commit-oid",A.textContent=S.shortOid,N.append(A,document.createTextNode(S.summary)),N}))}function c(r){let i=e.tour;if(!i||r<0||r>=i.scenes.length)return;e.activeSceneIndex=r,e.activeStepIndex=0;let l=i.scenes[r],h=i.chapters.findIndex(w=>w.sceneIds.includes(l.id)),p=i.chapters[h];document.querySelectorAll(".tour-scene").forEach(w=>{w.classList.toggle("is-active",w.dataset.sceneId===l.id)}),document.querySelectorAll(".tour-chapters button").forEach(w=>{w.classList.toggle("is-active",w.dataset.chapterId===p?.id)}),document.querySelector(`.tour-scene[data-scene-id="${l.id}"]`)?.scrollIntoView({block:"nearest"});let v=document.getElementById("tour-position"),k=document.getElementById("tour-previous"),D=document.getElementById("tour-next"),R=document.getElementById("tour-previous-chapter"),H=document.getElementById("tour-next-chapter");v&&(v.textContent=`${r+1} / ${i.scenes.length}`),k&&(k.disabled=r===0),D&&(D.disabled=r===i.scenes.length-1),R&&(R.disabled=h<=0),H&&(H.disabled=h<0||h>=i.chapters.length-1),L(l,p?.title||"Change tour");let E=new URLSearchParams(window.location.search);if(E.set("scene",l.id),window.history.replaceState(null,"",`${window.location.pathname}?${E.toString()}`),l.kind==="discussion"){document.body.classList.add("tour-discussion");return}if(document.body.classList.remove("tour-discussion"),l.kind==="walkthrough"){m(l);return}u(l,r)}function u(r,i,l=null,h=r.id){let p=e.tour;if(!p)return;let v=z(r.leftContent,r.rightContent);n({type:"showDiff",file1:r.leftLabel,file2:r.rightLabel,comparisonId:`tour-${h}`,leftContent:r.leftContent,rightContent:r.rightContent,diffModel:v,history:null,fileNavigation:{canGoPrevious:i>0,canGoNext:i<p.scenes.length-1},editableSides:{left:!1,right:!1},comparisonSummary:`${r.path} \xB7 ${r.takeaway}`,initialChangeIndex:l?b(v,l.side,l.startLine):r.focusChangeIndex,tourAnnotation:l})}function m(r){let i=r.steps[e.activeStepIndex];if(!i)return;L(r,y());let l=i.focus.revision==="base"?"left":"right";u(i.diff,e.activeSceneIndex,{side:l,startLine:i.focus.startLine,endLine:i.focus.endLine,label:`${i.title}: ${i.body}`},`${r.id}-${i.id}`)}function f(r){let i=e.tour?.scenes[e.activeSceneIndex];if(!i||i.kind!=="walkthrough")return!1;let l=e.activeStepIndex+r;return l<0||l>=i.steps.length?!1:(e.activeStepIndex=l,m(i),!0)}function y(){let r=e.tour,i=r?.scenes[e.activeSceneIndex];return r?.chapters.find(l=>i&&l.sceneIds.includes(i.id))?.title||"Change tour"}function b(r,i,l){let p=(i==="left"?r.leftLines:r.rightLines).findIndex(E=>E.lineNumber===l);if(p<0)return 0;let v=i==="left"?"leftStart":"rightStart",k=i==="left"?"leftEnd":"rightEnd",D=r.blocks.findIndex(E=>p>=E[v]&&p<E[k]);if(D>=0)return D;let R=0,H=Number.POSITIVE_INFINITY;return r.blocks.forEach((E,w)=>{let W=Math.min(Math.abs(p-E[v]),Math.abs(p-E[k]));W<H&&(R=w,H=W)}),R}function C(r){return/^[0-9a-f]{40}$/i.test(r)?r.slice(0,7):r}function I(r){let i=e.tour,h=i?.chapters.find(v=>v.id===r)?.sceneIds[0],p=i?.scenes.findIndex(v=>v.id===h)??-1;p>=0&&c(p)}function $(r){let i=e.tour,l=i?.scenes[e.activeSceneIndex];if(!i||!l)return;let h=i.chapters.findIndex(v=>v.sceneIds.includes(l.id)),p=i.chapters[h+r];p&&I(p.id)}function L(r,i){let l=document.getElementById("tour-narrative"),h=document.getElementById("tour-narrative-chapter"),p=document.getElementById("tour-narrative-title"),v=document.getElementById("tour-narrative-summary"),k=document.getElementById("tour-narrative-bullets"),D=document.getElementById("tour-narrative-tags"),R=document.getElementById("tour-narrative-takeaway"),H=document.getElementById("tour-step"),E=document.getElementById("tour-step-title"),w=document.getElementById("tour-step-body"),W=document.getElementById("tour-step-position"),S=document.getElementById("tour-step-previous"),N=document.getElementById("tour-step-next"),A=document.getElementById("tour-connection");if(!l||!h||!p||!v||!k||!D||!R||!H||!E||!w||!W||!S||!N||!A)throw new Error("Tour narrative UI is incomplete.");l.hidden=!1,h.textContent=i,p.textContent=r.title,v.textContent=r.summary,k.replaceChildren(...r.bullets.map(q=>{let O=document.createElement("li");return O.textContent=q,O})),D.replaceChildren(...r.tags.map(q=>{let O=document.createElement("span");return O.textContent=q,O})),R.textContent=r.takeaway;let x=r.kind==="walkthrough"?r.steps[e.activeStepIndex]:null;H.hidden=!x,x&&(E.textContent=x.title,w.textContent=x.body,W.textContent=`${e.activeStepIndex+1} / ${r.steps.length}`,S.disabled=e.activeStepIndex===0,N.disabled=e.activeStepIndex===r.steps.length-1,x.connection?(A.hidden=!1,A.textContent=`${x.connection.from.path} \u2192 ${x.connection.to.path} \xB7 ${x.connection.label}`):(A.hidden=!0,A.textContent=""))}function F(){let r=pe();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},g("Loaded sample diff."),n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:z(e.left.content,e.right.content),history:null})}async function B(r){let[i,l]=r,[h,p]=await Promise.all([i.text(),l.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:i.name,content:h},e.right={name:l.name,content:p},g(`Loaded ${i.name} and ${l.name}.`),n({type:"showDiff",file1:i.name,file2:l.name,comparisonId:`web-${e.comparisonId}`,leftContent:h,rightContent:p,diffModel:z(h,p),history:null})}async function U(r){let i=await Promise.all(r.map(async(l,h)=>{let p=await l.text();return{id:`web-panel-${h}`,label:l.name,content:p,savedContent:p,dirty:!1,editable:!0}}));e.mode="multi-diff",g(`Loaded ${i.length}-panel diff for ${i.map(l=>l.label).join(", ")}.`),n({type:"showMultiDiff",panels:i,pairs:i.slice(0,-1).map((l,h)=>({leftIndex:h,rightIndex:h+1,diffModel:z(l.content,i[h+1].content)}))})}function g(r){let i=document.getElementById("web-status");i&&(i.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
