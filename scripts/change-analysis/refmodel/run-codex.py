"""Repeat the frozen prompts using authenticated, fresh Codex CLI sessions."""
import concurrent.futures
import json
import pathlib
import subprocess
import sys
import tempfile
import time

from importlib.util import module_from_spec, spec_from_file_location

ROOT = pathlib.Path(__file__).resolve().parent
spec = spec_from_file_location('baseline', ROOT / 'run-refmodel.py')
baseline = module_from_spec(spec)
spec.loader.exec_module(baseline)


def main():
    config_bytes = (ROOT / 'codex-protocol.json').read_bytes()
    config = json.loads(config_bytes)
    original_bytes = (ROOT / 'protocol.json').read_bytes()
    assert baseline.sha(original_bytes) == config['originalProtocolSha256']
    original = json.loads(original_bytes)
    source, definitions = [pathlib.Path(p).read_bytes() for p in sys.argv[1:3]]
    assert baseline.sha(source) == original['sourceSha256']
    assert baseline.sha(definitions) == original['definitionsSha256']
    for path, key in [('grounded-instructions.txt', 'groundedInstructionsSha256'), ('evidence.json', 'evidenceSha256')]:
        assert baseline.sha((ROOT / path).read_bytes()) == original[key]
    fixtures = []
    for name, key in [('manifest.json', 'manifestSha256'), ('diagnostics.json', 'diagnosticsSha256')]:
        data = (ROOT.parent / 'semantic-corpus' / name).read_bytes()
        assert baseline.sha(data) == original[key]
        fixtures.extend(json.loads(data)['cases'])
    builder = baseline.original_builder(source.decode())
    evidence = json.loads((ROOT / 'evidence.json').read_text())
    tasks = []
    for index, case in enumerate(fixtures):
        mode, inputs = baseline.code_input(case)
        for arm in original['arms'][::1 if index % 2 == 0 else -1]:
            if arm == 'upstream':
                prompt = builder(mode, definitions.decode()).format(**inputs)
            else:
                prompt = ((ROOT / 'grounded-instructions.txt').read_text() + '\nCATALOG:\n' + definitions.decode()
                          + '\nCODE:\n' + json.dumps(inputs, ensure_ascii=False)
                          + '\nEVIDENCE:\n' + json.dumps(evidence[case['id']], ensure_ascii=False, separators=(',', ':')))
            tasks.append((case, arm, mode, prompt))
    assert len(tasks) <= config['maxRequests']

    def infer(task):
        case, arm, mode, prompt = task
        record = {'caseId': case['id'], 'arm': arm, 'mode': mode,
                  'promptSha256': baseline.sha(prompt.encode()), 'promptCharacters': len(prompt)}
        if len(prompt) > original['maxPromptCharacters']:
            return dict(record, status='unavailable', error='prompt-budget')
        start = time.monotonic()
        with tempfile.TemporaryDirectory(prefix='bygone-refmodel-codex-') as tmp:
            output = pathlib.Path(tmp) / 'response.txt'
            args = ['codex', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
                    '-C', tmp, '-s', 'read-only', '-m', config['requestedModel'],
                    '-c', 'model_reasoning_effort="' + config['reasoningEffort'] + '"',
                    '--json', '-o', str(output), '-']
            try:
                result = subprocess.run(args, input=config['harnessInstruction'] + '\n\n' + prompt,
                                        text=True, capture_output=True, timeout=config['timeoutSeconds'])
                events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
                items = [e['item'] for e in events if e.get('type') == 'item.completed']
                tool_items = [i['type'] for i in items if i['type'] not in ['agent_message', 'reasoning']]
                record['usage'] = next((e.get('usage') for e in events if e.get('type') == 'turn.completed'), None)
                record['toolItemTypes'] = tool_items
                record['response'] = {'response': output.read_text() if output.exists() else ''}
                record['status'] = 'complete' if result.returncode == 0 and output.exists() and not tool_items else 'unavailable'
                if record['status'] != 'complete':
                    record['error'] = {'exitCode': result.returncode, 'toolUse': tool_items,
                                       'events': [e for e in events if e.get('type') in ['error', 'turn.failed']]}
            except subprocess.TimeoutExpired:
                record.update(status='unavailable', error='timeout')
        record['elapsedSeconds'] = time.monotonic() - start
        return record

    report = {'version': 1, 'protocolSha256': baseline.sha(config_bytes),
              'requestedModel': config['requestedModel'], 'cliVersion': config['cliVersion'], 'runs': []}
    destination = ROOT.parent / 'results/refmodel-codex-2026-10-22.json'
    with concurrent.futures.ThreadPoolExecutor(max_workers=config['concurrency']) as pool:
        for result in pool.map(infer, tasks):
            report['runs'].append(result)
            destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(destination)


if __name__ == '__main__':
    main()
