/* global require, module */
const assert = require('node:assert/strict');

async function runPythonHighlightSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const source = [
        'def tracker_rows(self, since: date) -> list[TrackerRecord]:',
        '    """Every tracker build, stop and day row created since ``since``.',
        '',
        '    Tracker rows are the ones whose ``build_id`` starts with ``tracker:``.',
        '    """',
        '    query = f"""',
        '        SELECT event_type, survey_id, build_id, gender, local_date, outcome,',
        '               created_at, sample_bid_id, project_id, cpi_usd, completes_goal,',
        '               completes, day_outcome, locale',
        '        FROM `{self._dataset}.{_SAMPLING_EVENTS_TABLE}`',
        "        WHERE build_id LIKE 'tracker:%'",
        '    """',
        '    floor = datetime.combine(since, datetime.min.time(), UTC)',
        '    records = [tracker_record(dict(row)) for row in self._client.query_and_wait(query)]',
        '    return [record for record in records if record.created_at >= floor]',
        '',
        'def bid_progress(self, survey_id: str, sample_bid_id: str) -> list[BidProgress]:',
        '    """Every progress reading of one bid, oldest first.',
        '',
        "    Read from ``sample_bid_observations`` when a bid's completes change.",
        '    """',
        '    query = f"""',
        '        SELECT created_at, completes, is_active',
        '        FROM `{self._dataset}.{_OBSERVATIONS_TABLE}`',
        '        WHERE survey_id = @survey_id AND sample_bid_id = @sample_bid_id',
        '        ORDER BY created_at',
        '    """',
        '    return [bid_progress(dict(row)) for row in self._client.query_and_wait(query)]'
    ].join('\n');
    await show({ type: 'showDiff', file1: 'before.py', file2: 'after.py', leftContent: source, rightContent: source });
    // Await the production language loader, including its first-use registration.
    await evaluate(`window.monaco.languages.getLanguages().find(l => l.id === 'python').loader()`);
    async function tokensFor(content) {
        return evaluate(`window.monaco.editor.tokenize(${JSON.stringify(content)}, 'python')`);
    }
    function typeAt(tokens, content, line, text) {
        const offset = content.split('\n')[line].indexOf(text);
        assert.ok(offset >= 0, `Missing fixture text: ${text}`);
        return tokens[line].filter(t => t.offset <= offset).at(-1).type;
    }
    const tokens = await tokensFor(source);
    for (const [line, text, type] of [
        [3, 'Tracker', 'string.python'], [6, 'SELECT', 'string.python'],
        [7, 'created_at', 'string.python'], [9, 'self._dataset', 'identifier.python'],
        [10, 'WHERE', 'string.python'], [12, 'floor', 'identifier.python'],
        [14, 'return', 'keyword.python'], [16, 'def', 'keyword.python'],
        [19, 'Read', 'string.python'], [22, 'SELECT', 'string.python'],
        [27, 'return', 'keyword.python']
    ]) assert.equal(typeAt(tokens, source, line, text), type, `Python token at ${line + 1}: ${text}`);

    for (const quote of ['"""', "'''"]) {
        for (const prefix of ['f', 'F', 'fr', 'rf', 'FR', 'RF']) {
            const content = [
                `query = ${prefix}${quote}`,
                `SELECT 'single', "double", {{literal}}, {name!r}, {amount:.2f}`,
                '',
                `WHERE value = 1${quote}`,
                'return query',
                `one_line = ${prefix}${quote}hello {name}${quote}`,
                'return one_line'
            ].join('\n');
            const result = await tokensFor(content);
            for (const text of ['SELECT', 'single', 'double', 'literal']) {
                assert.equal(typeAt(result, content, 1, text), 'string.python', `${prefix}${quote}: ${text}`);
            }
            assert.equal(typeAt(result, content, 1, 'name'), 'identifier.python', `${prefix}${quote}: interpolation`);
            assert.equal(typeAt(result, content, 3, 'WHERE'), 'string.python');
            assert.equal(typeAt(result, content, 4, 'return'), 'keyword.python');
            assert.equal(typeAt(result, content, 6, 'return'), 'keyword.python');
        }
        const escaped = [
            `query = f${quote}escaped \\${quote}`,
            'still inside the string\\',
            `and another line${quote}`,
            'return query'
        ].join('\n');
        const escapedTokens = await tokensFor(escaped);
        assert.equal(typeAt(escapedTokens, escaped, 1, 'still'), 'string.python');
        assert.equal(typeAt(escapedTokens, escaped, 2, 'another'), 'string.python');
        assert.equal(typeAt(escapedTokens, escaped, 3, 'return'), 'keyword.python');
    }
    const ordinary = 'value = f"hello {name}"\nreturn value\n"""docstring"""\nreturn value';
    const ordinaryTokens = await tokensFor(ordinary);
    assert.equal(typeAt(ordinaryTokens, ordinary, 0, 'name'), 'identifier.python');
    assert.equal(typeAt(ordinaryTokens, ordinary, 1, 'return'), 'keyword.python');
    assert.equal(typeAt(ordinaryTokens, ordinary, 2, 'docstring'), 'string.python');
    assert.equal(typeAt(ordinaryTokens, ordinary, 3, 'return'), 'keyword.python');
}

module.exports = { runPythonHighlightSmoke };
