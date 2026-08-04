"use strict";(()=>{function W(){}W.prototype={diff:function(e,n){var i,a=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},s=a.callback;typeof a=="function"&&(s=a,a={}),this.options=a;var c=this;function l(x){return s?(setTimeout(function(){s(void 0,x)},0),!0):x}e=this.castInput(e),n=this.castInput(n),e=this.removeEmpty(this.tokenize(e)),n=this.removeEmpty(this.tokenize(n));var h=n.length,g=e.length,f=1,m=h+g;a.maxEditLength&&(m=Math.min(m,a.maxEditLength));var y=(i=a.timeout)!==null&&i!==void 0?i:1/0,v=Date.now()+y,I=[{oldPos:-1,lastComponent:void 0}],N=this.extractCommon(I[0],n,e,0);if(I[0].oldPos+1>=g&&N+1>=h)return l([{value:this.join(n),count:n.length}]);var L=-1/0,$=1/0;function k(){for(var x=Math.max(L,-f);x<=Math.min($,f);x+=2){var F=void 0,D=I[x-1],R=I[x+1];D&&(I[x-1]=void 0);var Y=!1;if(R){var P=R.oldPos-x;Y=R&&0<=P&&P<h}var r=D&&D.oldPos+1<g;if(!Y&&!r){I[x]=void 0;continue}if(!r||Y&&D.oldPos+1<R.oldPos?F=c.addToPath(R,!0,void 0,0):F=c.addToPath(D,void 0,!0,1),N=c.extractCommon(F,n,e,x),F.oldPos+1>=g&&N+1>=h)return l(Ne(c,F.lastComponent,n,e,c.useLongestToken));I[x]=F,F.oldPos+1>=g&&($=Math.min($,x-1)),N+1>=h&&(L=Math.max(L,x+1))}f++}if(s)(function x(){setTimeout(function(){if(f>m||Date.now()>v)return s();k()||x()},0)})();else for(;f<=m&&Date.now()<=v;){var M=k();if(M)return M}},addToPath:function(e,n,i,a){var s=e.lastComponent;return s&&s.added===n&&s.removed===i?{oldPos:e.oldPos+a,lastComponent:{count:s.count+1,added:n,removed:i,previousComponent:s.previousComponent}}:{oldPos:e.oldPos+a,lastComponent:{count:1,added:n,removed:i,previousComponent:s}}},extractCommon:function(e,n,i,a){for(var s=n.length,c=i.length,l=e.oldPos,h=l-a,g=0;h+1<s&&l+1<c&&this.equals(n[h+1],i[l+1]);)h++,l++,g++;return g&&(e.lastComponent={count:g,previousComponent:e.lastComponent}),e.oldPos=l,h},equals:function(e,n){return this.options.comparator?this.options.comparator(e,n):e===n||this.options.ignoreCase&&e.toLowerCase()===n.toLowerCase()},removeEmpty:function(e){for(var n=[],i=0;i<e.length;i++)e[i]&&n.push(e[i]);return n},castInput:function(e){return e},tokenize:function(e){return e.split("")},join:function(e){return e.join("")}};function Ne(t,e,n,i,a){for(var s=[],c;e;)s.push(e),c=e.previousComponent,delete e.previousComponent,e=c;s.reverse();for(var l=0,h=s.length,g=0,f=0;l<h;l++){var m=s[l];if(m.removed){if(m.value=t.join(i.slice(f,f+m.count)),f+=m.count,l&&s[l-1].added){var v=s[l-1];s[l-1]=s[l],s[l]=v}}else{if(!m.added&&a){var y=n.slice(g,g+m.count);y=y.map(function(N,L){var $=i[f+L];return $.length>N.length?$:N}),m.value=t.join(y)}else m.value=t.join(n.slice(g,g+m.count));g+=m.count,m.added||(f+=m.count)}}var I=s[h-1];return h>1&&typeof I.value=="string"&&(I.added||I.removed)&&t.equals("",I.value)&&(s[h-2].value+=I.value,s.pop()),s}var $e=new W;function he(t,e,n){return $e.diff(t,e,n)}var de=/^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/,ue=/\S/,le=new W;le.equals=function(t,e){return this.options.ignoreCase&&(t=t.toLowerCase(),e=e.toLowerCase()),t===e||this.options.ignoreWhitespace&&!ue.test(t)&&!ue.test(e)};le.tokenize=function(t){for(var e=t.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/),n=0;n<e.length-1;n++)!e[n+1]&&e[n+2]&&de.test(e[n])&&de.test(e[n+2])&&(e[n]+=e[n+2],e.splice(n+1,2),n--);return e};function ge(t,e,n){return le.diff(t,e,n)}var me=new W;me.tokenize=function(t){this.options.stripTrailingCr&&(t=t.replace(/\r\n/g,`
`));var e=[],n=t.split(/(\n|\r\n)/);n[n.length-1]||n.pop();for(var i=0;i<n.length;i++){var a=n[i];i%2&&!this.options.newlineIsToken?e[e.length-1]+=a:(this.options.ignoreWhitespace&&(a=a.trim()),e.push(a))}return e};var Fe=new W;Fe.tokenize=function(t){return t.split(/(\S.+?[.!?])(?=\s+|$)/)};var ke=new W;ke.tokenize=function(t){return t.split(/([{}:;,]|\s+)/)};function Z(t){"@babel/helpers - typeof";return typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?Z=function(e){return typeof e}:Z=function(e){return e&&typeof Symbol=="function"&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},Z(t)}var De=Object.prototype.toString,X=new W;X.useLongestToken=!0;X.tokenize=me.tokenize;X.castInput=function(t){var e=this.options,n=e.undefinedReplacement,i=e.stringifyReplacer,a=i===void 0?function(s,c){return typeof c>"u"?n:c}:i;return typeof t=="string"?t:JSON.stringify(ae(t,null,null,a),a,"  ")};X.equals=function(t,e){return W.prototype.equals.call(X,t.replace(/,([\r\n])/g,"$1"),e.replace(/,([\r\n])/g,"$1"))};function ae(t,e,n,i,a){e=e||[],n=n||[],i&&(t=i(a,t));var s;for(s=0;s<e.length;s+=1)if(e[s]===t)return n[s];var c;if(De.call(t)==="[object Array]"){for(e.push(t),c=new Array(t.length),n.push(c),s=0;s<t.length;s+=1)c[s]=ae(t[s],e,n,i,a);return e.pop(),n.pop(),c}if(t&&t.toJSON&&(t=t.toJSON()),Z(t)==="object"&&t!==null){e.push(t),c={},n.push(c);var l=[],h;for(h in t)t.hasOwnProperty(h)&&l.push(h);for(l.sort(),s=0;s<l.length;s+=1)h=l[s],c[h]=ae(t[h],e,n,i,h);e.pop(),n.pop()}else c=t;return c}var Q=new W;Q.tokenize=function(t){return t.slice()};Q.join=Q.removeEmpty=function(t){return t};function pe(t,e,n){return Q.diff(t,e,n)}var Oe=500,we=We("BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH",Oe);function V(t,e){let n=ye(t),i=ye(e),a=pe(n,i),s=[],c=[],l=[],h=[],g=1,f=1;for(let y=0;y<a.length;y++){let v=a[y],I=v.removed?v.value:[],N=v.added?v.value:[];if(!v.added&&!v.removed){for(let L of v.value)c.push(J("context",L,g)),l.push(J("context",L,f)),s.push(te(_("context",L,g++),_("context",L,f++)));continue}if(v.removed&&y+1<a.length&&a[y+1].added){let L=a[y+1],$=c.length,k=l.length,M=Re(I,L.value);for(let{left:x,right:F}of M){let D,R;x!==void 0&&(D=J("removed",x,g),c.push(D)),F!==void 0&&(R=J("added",F,f),l.push(R)),D&&R&&Me(D,R),s.push(te(x===void 0?ee():_("removed",x,g++),F===void 0?ee():_("added",F,f++)))}h.push(ce("replace",$,c.length,k,l.length)),y++;continue}if(v.removed){let L=c.length,$=l.length;for(let k of I)c.push(J("removed",k,g)),s.push(te(_("removed",k,g++),ee()));h.push(ce("delete",L,c.length,$,l.length));continue}if(v.added){let L=c.length,$=l.length;for(let k of N)l.push(J("added",k,f)),s.push(te(ee(),_("added",k,f++)));h.push(ce("insert",L,c.length,$,l.length))}}let m=s.some(y=>y.left.kind!=="context"||y.right.kind!=="context");return{rows:s,leftLines:c,rightLines:l,blocks:h,hasChanges:m}}function ye(t){if(t.length===0)return[];let e=t.replace(/\r\n/g,`
`).split(`
`);return e[e.length-1]===""&&e.pop(),e}function Re(t,e){if(t.length*e.length>1e4)return Pe(t,e);let i=0,a=.45,s=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(Number.NEGATIVE_INFINITY)),c=Array.from({length:t.length+1},()=>new Array(e.length+1).fill(null));s[0][0]=0;for(let f=1;f<=t.length;f++)s[f][0]=s[f-1][0]+i,c[f][0]="left";for(let f=1;f<=e.length;f++)s[0][f]=s[0][f-1]+i,c[0][f]="right";for(let f=1;f<=t.length;f++)for(let m=1;m<=e.length;m++){let y=He(t[f-1],e[m-1]),I=[{move:"match",score:y>a?s[f-1][m-1]+Math.pow(y-a,2):Number.NEGATIVE_INFINITY},{move:"left",score:s[f-1][m]+i},{move:"right",score:s[f][m-1]+i}].reduce((N,L)=>L.score>N.score?L:N);s[f][m]=I.score,c[f][m]=I.move}let l=[],h=t.length,g=e.length;for(;h>0||g>0;){let f=c[h][g];f==="match"?l.push({left:t[--h],right:e[--g]}):f==="left"?l.push({left:t[--h]}):l.push({right:e[--g]})}return l.reverse()}function Pe(t,e){let n=Math.max(t.length,e.length);return Array.from({length:n},(i,a)=>({left:t[a],right:e[a]}))}function He(t,e){let n=t.length+e.length;return n===0?1:2*he(t,e).filter(a=>!a.added&&!a.removed).reduce((a,s)=>a+s.value.length,0)/n}function Me(t,e){if(t.content.length>we||e.content.length>we)return;let{leftSegments:n,rightSegments:i,hasInlineChanges:a}=Be(t.content,e.content);a&&(t.segments=n,e.segments=i)}function Be(t,e){let n=ge(t,e),i=[],a=[],s=!1;for(let c of n){let l=c.value;if(!c.added&&!c.removed){let g={kind:"context",text:l,emphasis:!1};i.push(g),a.push(g);continue}let h=/[^\s]/.test(l);s=s||h,c.removed&&i.push({kind:"removed",text:l,emphasis:h}),c.added&&a.push({kind:"added",text:l,emphasis:h})}return{leftSegments:i,rightSegments:a,hasInlineChanges:s}}function ee(){return{kind:"placeholder",content:"",lineNumber:null}}function _(t,e,n){return{kind:t,content:e,lineNumber:n}}function J(t,e,n){return{kind:t,content:e,lineNumber:n}}function te(t,e){return{left:t,right:e}}function ce(t,e,n,i,a){return{kind:t,leftStart:e,leftEnd:n,rightStart:i,rightEnd:a}}function We(t,e){let n=typeof process<"u"?process.env?.[t]:void 0,i=Number.parseInt(n??"",10);return Number.isFinite(i)&&i>0?i:e}function xe(){return{leftFileName:"test-file-1.js",rightFileName:"test-file-2.js",leftContent:`// Test File 1 - Example JavaScript Code
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
`}}function Ie(t){if(!H(t)||t.version!==1)throw new Error("Unsupported or missing change-tour manifest version.");if(T(t.title,"title"),T(t.generatedAt,"generatedAt"),t.sourceUrl!==void 0&&T(t.sourceUrl,"sourceUrl"),!H(t.range))throw new Error("Change-tour manifest range must be an object.");for(let n of["baseRef","headRef","mergeBaseOid","headOid"])T(t.range[n],`range.${n}`);if(!H(t.summary))throw new Error("Change-tour manifest summary must be an object.");for(let n of["changedFiles","includedScenes","additions","deletions","commitCount"])ne(t.summary[n],`summary.${n}`);if(re(t.summary.omittedFiles,"summary.omittedFiles"),!Array.isArray(t.commits)||!Array.isArray(t.chapters)||!Array.isArray(t.scenes))throw new Error("Change-tour manifest commits, chapters, and scenes must be arrays.");let e=new Set;for(let[n,i]of t.scenes.entries()){if(Le(i,n),e.has(i.id))throw new Error(`Duplicate change-tour scene id: ${i.id}`);e.add(i.id)}for(let[n,i]of t.chapters.entries()){if(!H(i))throw new Error(`chapters[${n}] must be an object.`);T(i.id,`chapters[${n}].id`),T(i.title,`chapters[${n}].title`),re(i.sceneIds,`chapters[${n}].sceneIds`);for(let a of i.sceneIds)if(!e.has(a))throw new Error(`Chapter references unknown scene id: ${a}`)}if(t.summary.includedScenes!==t.scenes.length)throw new Error("summary.includedScenes must match the number of scenes.");return t}function Le(t,e){if(!H(t)||!["text-diff","discussion","walkthrough"].includes(String(t.kind)))throw new Error(`scenes[${e}] must be a text-diff, discussion, or walkthrough scene.`);for(let n of["id","title"])T(t[n],`scenes[${e}].${n}`);if(Ue(t,`scenes[${e}]`),t.kind!=="discussion"){if(t.kind==="walkthrough"){if(!Array.isArray(t.steps)||t.steps.length===0)throw new Error(`scenes[${e}].steps must be a non-empty array.`);for(let[n,i]of t.steps.entries()){let a=`scenes[${e}].steps[${n}]`;if(!H(i)||!H(i.focus)||!H(i.diff))throw new Error(`${a} must contain focus and diff objects.`);for(let s of["id","title","body"])T(i[s],`${a}.${s}`);if(fe(i.focus,`${a}.focus`),Le(i.diff,e),i.diff.kind!=="text-diff")throw new Error(`${a}.diff must be a text-diff scene.`);if(i.connection!==void 0){if(!H(i.connection))throw new Error(`${a}.connection must be an object.`);T(i.connection.id,`${a}.connection.id`),T(i.connection.label,`${a}.connection.label`),fe(i.connection.from,`${a}.connection.from`),fe(i.connection.to,`${a}.connection.to`)}}return}for(let n of["path","leftLabel","rightLabel","leftContent","rightContent"])T(t[n],`scenes[${e}].${n}`);t.previousPath!==void 0&&T(t.previousPath,`scenes[${e}].previousPath`),T(t.changeKind,`scenes[${e}].changeKind`),ne(t.additions,`scenes[${e}].additions`),ne(t.deletions,`scenes[${e}].deletions`),t.focusChangeIndex!==void 0&&ne(t.focusChangeIndex,`scenes[${e}].focusChangeIndex`)}}function fe(t,e){if(!H(t))throw new Error(`${e} must be an object.`);for(let n of["id","path","revision","excerpt"])T(t[n],`${e}.${n}`);if(t.revision!=="base"&&t.revision!=="head")throw new Error(`${e}.revision must be base or head.`);if(ve(t.startLine,`${e}.startLine`),ve(t.endLine,`${e}.endLine`),Number(t.endLine)<Number(t.startLine))throw new Error(`${e}.endLine must not precede startLine.`)}function Ue(t,e){T(t.summary,`${e}.summary`),re(t.bullets,`${e}.bullets`),re(t.tags,`${e}.tags`),T(t.takeaway,`${e}.takeaway`)}function H(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function T(t,e){if(typeof t!="string")throw new Error(`${e} must be a string.`)}function re(t,e){if(!Array.isArray(t)||t.some(n=>typeof n!="string"))throw new Error(`${e} must be an array of strings.`)}function ne(t,e){if(!Number.isInteger(t)||Number(t)<0)throw new Error(`${e} must be a non-negative integer.`)}function ve(t,e){if(!Number.isInteger(t)||Number(t)<1)throw new Error(`${e} must be a positive integer.`)}function be(t,e,n){let i=t.findIndex(l=>l.id===e),a=i>=0?i:0,s=t[a];if(!s||s.kind!=="walkthrough"||!n)return{sceneIndex:a,stepIndex:0};let c=s.steps.findIndex(l=>l.id===n);return{sceneIndex:a,stepIndex:c>=0?c:0}}function Ce(t,e,n){let i=t[e.sceneIndex];if(!i)return null;if(n>0)return i.kind==="walkthrough"&&e.stepIndex<i.steps.length-1?{sceneIndex:e.sceneIndex,stepIndex:e.stepIndex+1}:e.sceneIndex<t.length-1?{sceneIndex:e.sceneIndex+1,stepIndex:0}:null;if(i.kind==="walkthrough"&&e.stepIndex>0)return{sceneIndex:e.sceneIndex,stepIndex:e.stepIndex-1};if(e.sceneIndex===0)return null;let a=t[e.sceneIndex-1];return{sceneIndex:e.sceneIndex-1,stepIndex:a.kind==="walkthrough"?a.steps.length-1:0}}function Ee(t,e,n){let i=[],a=new Set,s=f=>{a.has(f.path)||(a.add(f.path),i.push(f))};t.forEach((f,m)=>{if(f.kind==="text-diff"){s({sceneIndex:m,stepIndex:0,path:f.path});return}f.kind==="walkthrough"&&f.steps.forEach((y,v)=>{s({sceneIndex:m,stepIndex:v,path:y.diff.path})})});let c=t[e.sceneIndex],l=c?.kind==="text-diff"?c.path:c?.kind==="walkthrough"?c.steps[e.stepIndex]?.diff.path:null;if(!l)return null;let h=i.findIndex(f=>f.path===l),g=h+n;return h>=0&&g>=0&&g<i.length?i[g]:null}(function(){let e={mode:"empty",left:null,right:null,comparisonId:0,tour:null,activeSceneIndex:-1,activeStepIndex:0};window.__BYGONE_HOST__={environment:"web",editorWorkerUrl:"/media/editor.worker.js",postMessage(r){i(r)}},window.addEventListener("DOMContentLoaded",()=>{a(),P("Browser host ready.")});function n(r){window.dispatchEvent(new window.CustomEvent("bygone:host-message",{detail:r}))}async function i(r){if(!(!r||typeof r!="object")){if(r.type==="ready"){let o=new URLSearchParams(window.location.search),u=o.get("manifest");u?s(u):o.get("demo")==="1"&&D();return}if(r.type==="navigateFile"&&e.mode==="tour"){I(r.direction==="previous"?-1:1);return}r.type==="recomputeDiff"&&e.mode==="diff"&&e.left&&e.right&&(e.left.content=r.leftContent,e.right.content=r.rightContent,n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:V(e.left.content,e.right.content),history:null}))}}function a(){let r=document.getElementById("web-compare-test"),o=document.getElementById("web-open-diff"),u=document.getElementById("web-open-diff3"),d=document.getElementById("web-diff-input"),p=document.getElementById("web-diff3-input"),C=document.getElementById("tour-previous"),E=document.getElementById("tour-next");r?.addEventListener("click",()=>{D()}),o?.addEventListener("click",()=>{d.value="",d.click()}),u?.addEventListener("click",()=>{p.value="",p.click()}),d?.addEventListener("change",async()=>{let w=Array.from(d.files||[]);if(w.length!==2){P("Select exactly 2 files for a diff.");return}await R(w)}),p?.addEventListener("change",async()=>{let w=Array.from(p.files||[]);if(w.length<1){P("Select one or more files.");return}await Y(w)}),C?.addEventListener("click",()=>y(-1)),E?.addEventListener("click",()=>y(1)),window.addEventListener("keydown",w=>{e.mode!=="tour"||w.metaKey||w.ctrlKey||w.altKey||x(w.target)||(w.key==="PageUp"||w.key==="ArrowLeft"?(w.preventDefault(),y(-1)):(w.key==="PageDown"||w.key==="ArrowRight")&&(w.preventDefault(),y(1)))})}async function s(r){P("Loading change tour\u2026");try{let o=await fetch(r,{cache:"no-store"});if(!o.ok)throw new Error(`Manifest request failed (${o.status}).`);e.tour=Ie(await o.json()),e.mode="tour",document.body.classList.add("tour-mode"),c();let u=new URLSearchParams(window.location.search),d=be(e.tour.scenes,u.get("scene"),u.get("step"));l(d.sceneIndex,d.stepIndex),P("")}catch(o){P(`Could not load change tour: ${o instanceof Error?o.message:String(o)}`)}}function c(){let r=e.tour;if(!r)return;let o=document.getElementById("tour-shell"),u=document.getElementById("tour-title"),d=document.getElementById("tour-source"),p=document.getElementById("tour-range"),C=document.getElementById("tour-stats"),E=document.getElementById("tour-scenes"),w=document.getElementById("tour-commits"),U=document.getElementById("tour-commits-summary");if(!o||!u||!d||!p||!C||!E||!w||!U)throw new Error("Presenter UI is incomplete.");o.hidden=!1,u.textContent=r.title,r.sourceUrl?(d.href=r.sourceUrl,d.hidden=!1):d.hidden=!0;let G=k(r.range.baseRef),A=k(r.range.headRef),j=r.range.headOid.slice(0,7);p.textContent=`${G} \u2192 ${A}${A===j?"":` \xB7 ${j}`}`,C.textContent=`${M(r.summary.changedFiles,"file")} \xB7 +${r.summary.additions} \u2212${r.summary.deletions} \xB7 ${M(r.summary.commitCount,"commit")}`,U.textContent=M(r.summary.commitCount,"commit"),E.replaceChildren();let z=new Map(r.scenes.map(S=>[S.id,S]));for(let S of r.chapters){let B=document.createElement("h2");B.className="tour-chapter-title",B.textContent=S.title,E.append(B);for(let q of S.sceneIds){let b=z.get(q);if(!b)continue;let K=r.scenes.indexOf(b),O=document.createElement("button");O.type="button",O.className="tour-scene",O.dataset.sceneId=b.id,O.title=b.kind==="text-diff"?b.path:b.title,O.addEventListener("click",()=>l(K));let ie=document.createElement("span");ie.className="tour-scene-number",ie.textContent=String(K+1).padStart(2,"0");let oe=document.createElement("span");oe.className="tour-scene-copy";for(let[Se,Te]of[["tour-scene-title",b.title],["tour-scene-path",b.kind==="text-diff"?b.path:b.kind==="walkthrough"?M(b.steps.length,"code step"):"Discussion"],["tour-scene-note",b.takeaway]]){let se=document.createElement("span");se.className=Se,se.textContent=Te,oe.append(se)}O.append(ie,oe),E.append(O)}}w.replaceChildren(...r.commits.map(S=>{let B=document.createElement("li"),q=document.createElement("span");return q.className="tour-commit-oid",q.textContent=S.shortOid,B.append(q,document.createTextNode(S.summary)),B}))}function l(r,o=0){let u=e.tour;if(!u||r<0||r>=u.scenes.length)return;let d=u.scenes[r];e.activeSceneIndex=r,e.activeStepIndex=d.kind==="walkthrough"?Math.min(Math.max(o,0),Math.max(d.steps.length-1,0)):0;let p=N(u,r);document.querySelectorAll(".tour-scene").forEach(E=>{E.classList.toggle("is-active",E.dataset.sceneId===d.id)}),document.querySelector(`.tour-scene[data-scene-id="${d.id}"]`)?.scrollIntoView({block:"nearest"}),F(d,p);let C=new URLSearchParams(window.location.search);if(C.set("scene",d.id),d.kind==="walkthrough"?C.set("step",d.steps[e.activeStepIndex].id):C.delete("step"),window.history.replaceState(null,"",`${window.location.pathname}?${C.toString()}`),d.kind==="discussion"){document.body.classList.add("tour-discussion");return}if(document.body.classList.remove("tour-discussion"),d.kind==="walkthrough"){f(d);return}h(d)}function h(r,o=null,u=r.id){if(!e.tour)return;let p=V(r.leftContent,r.rightContent),C=g(r,r.leftLabel,"base"),E=g(r,r.rightLabel,"head");n({type:"showDiff",file1:C,file2:E,comparisonId:`tour-${u}`,leftContent:r.leftContent,rightContent:r.rightContent,diffModel:p,history:null,fileNavigation:{canGoPrevious:!!v(-1),canGoNext:!!v(1)},editableSides:{left:!1,right:!1},comparisonSummary:`${r.path} \xB7 ${r.takeaway}`,initialChangeIndex:o?$(p,o.side,o.startLine):r.focusChangeIndex,tourAnnotation:o})}function g(r,o,u){let d=o.startsWith(r.path)?o.slice(r.path.length).trim():o.trim();return d?`${u} ${d}`:u}function f(r){let o=r.steps[e.activeStepIndex];if(!o)return;let u=o.focus.revision==="base"?"left":"right";h(o.diff,{side:u,startLine:o.focus.startLine,endLine:o.focus.endLine,label:`${o.title}: ${o.body}`},`${r.id}-${o.id}`)}function m(r){let o=e.tour;return!o||r!==-1&&r!==1?null:Ce(o.scenes,{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex},r)}function y(r){let o=m(r);return o?(l(o.sceneIndex,o.stepIndex),!0):!1}function v(r){let o=e.tour;return!o||r!==-1&&r!==1?null:Ee(o.scenes,{sceneIndex:e.activeSceneIndex,stepIndex:e.activeStepIndex},r)}function I(r){let o=v(r);return o?(l(o.sceneIndex,o.stepIndex),!0):!1}function N(r,o){let u=r.scenes[o],d=r.chapters.findIndex(w=>w.sceneIds.includes(u.id)),p=d>=0?r.chapters[d]:null,C=p?p.sceneIds.indexOf(u.id)+1:o+1,E=p?p.sceneIds.length:r.scenes.length;return{chapter:p,chapterIndex:d,chapterNumber:d>=0?d+1:o+1,sceneInChapter:C,scenesInChapter:E}}function L(r,o,u){let d=[`Ch ${r.chapterNumber}`,`Scene ${r.sceneInChapter}/${r.scenesInChapter}`];return o.kind==="walkthrough"&&d.push(`Step ${u+1}/${o.steps.length}`),d.join(" \xB7 ")}function $(r,o,u){let p=(o==="left"?r.leftLines:r.rightLines).findIndex(A=>A.lineNumber===u);if(p<0)return 0;let C=o==="left"?"leftStart":"rightStart",E=o==="left"?"leftEnd":"rightEnd",w=r.blocks.findIndex(A=>p>=A[C]&&p<A[E]);if(w>=0)return w;let U=0,G=Number.POSITIVE_INFINITY;return r.blocks.forEach((A,j)=>{let z=Math.min(Math.abs(p-A[C]),Math.abs(p-A[E]));z<G&&(U=j,G=z)}),U}function k(r){return/^[0-9a-f]{40}$/i.test(r)?r.slice(0,7):r}function M(r,o){return`${r} ${r===1?o:`${o}s`}`}function x(r){return r instanceof Element&&!!r.closest('a, button, input, select, summary, textarea, [contenteditable="true"], [role="textbox"], .monaco-editor')}function F(r,o){let u=document.getElementById("tour-narrative"),d=document.getElementById("tour-breadcrumb"),p=document.getElementById("tour-narrative-chapter"),C=document.getElementById("tour-narrative-title"),E=document.getElementById("tour-narrative-summary"),w=document.getElementById("tour-narrative-bullets"),U=document.getElementById("tour-narrative-tags"),G=document.getElementById("tour-narrative-takeaway"),A=document.getElementById("tour-step"),j=document.getElementById("tour-step-title"),z=document.getElementById("tour-step-body"),S=document.getElementById("tour-connection"),B=document.getElementById("tour-previous"),q=document.getElementById("tour-next");if(!u||!d||!p||!C||!E||!w||!U||!G||!A||!j||!z||!S||!B||!q)throw new Error("Tour narrative UI is incomplete.");u.hidden=!1,d.textContent=L(o,r,e.activeStepIndex),p.textContent=o.chapter?.title||"Change tour",C.textContent=r.title,E.textContent=r.summary,w.replaceChildren(...r.bullets.map(K=>{let O=document.createElement("li");return O.textContent=K,O})),U.replaceChildren(...r.tags.map(K=>{let O=document.createElement("span");return O.textContent=K,O})),G.textContent=r.takeaway;let b=r.kind==="walkthrough"?r.steps[e.activeStepIndex]:null;A.hidden=!b,b?(j.textContent=b.title,z.textContent=b.body,b.connection?(S.hidden=!1,S.textContent=`${b.connection.from.path} \u2192 ${b.connection.to.path} \xB7 ${b.connection.label}`):(S.hidden=!0,S.textContent="")):(S.hidden=!0,S.textContent=""),B.disabled=!m(-1),q.disabled=!m(1)}function D(){let r=xe();e.mode="diff",e.comparisonId+=1,e.left={name:r.leftFileName,content:r.leftContent},e.right={name:r.rightFileName,content:r.rightContent},P("Loaded sample diff."),n({type:"showDiff",file1:e.left.name,file2:e.right.name,comparisonId:`web-${e.comparisonId}`,leftContent:e.left.content,rightContent:e.right.content,diffModel:V(e.left.content,e.right.content),history:null})}async function R(r){let[o,u]=r,[d,p]=await Promise.all([o.text(),u.text()]);e.mode="diff",e.comparisonId+=1,e.left={name:o.name,content:d},e.right={name:u.name,content:p},P(`Loaded ${o.name} and ${u.name}.`),n({type:"showDiff",file1:o.name,file2:u.name,comparisonId:`web-${e.comparisonId}`,leftContent:d,rightContent:p,diffModel:V(d,p),history:null})}async function Y(r){let o=await Promise.all(r.map(async(u,d)=>{let p=await u.text();return{id:`web-panel-${d}`,label:u.name,content:p,savedContent:p,dirty:!1,editable:!0}}));e.mode="multi-diff",P(`Loaded ${o.length}-panel diff for ${o.map(u=>u.label).join(", ")}.`),n({type:"showMultiDiff",panels:o,pairs:o.slice(0,-1).map((u,d)=>({leftIndex:d,rightIndex:d+1,diffModel:V(u.content,o[d+1].content)}))})}function P(r){let o=document.getElementById("web-status");o&&(o.textContent=r)}})();})();
//# sourceMappingURL=web-host.js.map
