"""Bounded RefModel-template test. Standard library only; no upstream CLI side effects."""
import ast
import hashlib
import json
import pathlib
import time
import urllib.request
import sys
import difflib

ROOT = pathlib.Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()

class Template:
    def __init__(self, input_variables, template):
        self.template = template
    def format(self, **kw):
        return self.template.format(**kw)

def original_builder(source):
    tree = ast.parse(source)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_template')
    env = {'PromptTemplate': Template, 'P1': '{program1}', 'P2': '{program2}', 'PDIFF': '{diff}'}
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<isolated-upstream-template>', 'exec'), env)
    return env['build_template']

def scoped(case):
    a,b = case['before'],case['after']
    if case.get('excludeUnchanged'):
        keys = [p for p in sorted(set(a)|set(b)) if a.get(p)!=b.get(p)]
        a,b = {p:a[p] for p in keys if p in a},{p:b[p] for p in keys if p in b}
    return a,b

def code_input(case):
    a,b = scoped(case)
    old,new = json.dumps(a,ensure_ascii=False,indent=2),json.dumps(b,ensure_ascii=False,indent=2)
    if len(old)+len(new)<=24000:
        return 'complete', {'program1':old,'program2':new}
    diff = []
    for name in sorted(set(a)|set(b)):
        diff.extend(difflib.unified_diff(a.get(name,'').splitlines(True),b.get(name,'').splitlines(True),fromfile='before/'+name,tofile='after/'+name,n=3))
    return 'diff',{'diff':''.join(diff)}

def main():
    source_path,definitions_path = map(pathlib.Path,sys.argv[1:3])
    config=json.loads((ROOT/'protocol.json').read_text())
    source,definitions=source_path.read_bytes(),definitions_path.read_bytes()
    assert sha(source)==config['sourceSha256'] and sha(definitions)==config['definitionsSha256']
    assert sha((ROOT/'grounded-instructions.txt').read_bytes())==config['groundedInstructionsSha256']
    assert sha((ROOT/'evidence.json').read_bytes())==config['evidenceSha256']
    fixtures=[]
    for file,key in [('manifest.json','manifestSha256'),('diagnostics.json','diagnosticsSha256')]:
        data=(ROOT.parent/'semantic-corpus'/file).read_bytes();assert sha(data)==config[key]
        fixtures.extend(json.loads(data)['cases'])
    assert len(fixtures)*len(config['arms'])<=config['maxRequests']
    builder=original_builder(source.decode())
    definitions=definitions.decode()
    evidence=json.loads((ROOT/'evidence.json').read_text())
    report={'version':1,'protocolSha256':sha((ROOT/'protocol.json').read_bytes()),'runs':[]}
    destination=ROOT.parent/'results/refmodel-2026-10-22.json'
    # Alternate arm order by case; each inference has a fresh context.
    for index,case in enumerate(fixtures):
        mode,inputs=code_input(case)
        for arm in config['arms'][::1 if index%2==0 else -1]:
            plain=builder(mode,definitions).format(**inputs)
            if arm=='upstream': prompt=plain
            else:
                prompt=(ROOT/'grounded-instructions.txt').read_text()+'\nCATALOG:\n'+definitions+'\nCODE:\n'+json.dumps(inputs,ensure_ascii=False)+'\nEVIDENCE:\n'+json.dumps(evidence[case['id']],ensure_ascii=False,separators=(',',':'))
            record={'caseId':case['id'],'arm':arm,'mode':mode,'promptSha256':sha(prompt.encode()),'promptCharacters':len(prompt),
                    'inputPaths':{side:list(files) for side,files in zip(['before','after'],scoped(case))}}
            report['runs'].append(record)
            if len(prompt)>config['maxPromptCharacters']:
                record.update(status='unavailable',error='prompt-budget')
            else:
                start=time.monotonic()
                try:
                    request={'model':config['requestedModel'],'prompt':prompt,'stream':False,'think':config['think'],'options':config['settings']}
                    response=json.load(urllib.request.urlopen(urllib.request.Request(config['backend'],json.dumps(request).encode(),{'Content-Type':'application/json'}),timeout=config['timeoutSeconds']))
                    # Preserve the final response and execution metadata. Internal
                    # reasoning traces are neither scored nor persisted.
                    record['response']={k:v for k,v in response.items() if k not in ['thinking','context']}
                    record['status']='complete' if response.get('done_reason')=='stop' else 'partial'
                except Exception as error: record.update(status='unavailable',error=type(error).__name__+': '+str(error))
                record['elapsedSeconds']=time.monotonic()-start
            destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(str(destination))
if __name__=='__main__': main()
