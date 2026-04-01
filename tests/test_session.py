import tempfile
from pathlib import Path

from server import Session


def make_session(tmp_path: Path) -> Session:
    output = str(tmp_path / 'review.md')
    return Session(
        repo_path=str(tmp_path),
        base_branch='main',
        description='test',
        output_path=output,
    )


def test_items_starts_with_diff(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    assert len(s.items) == 1
    assert s.items[0]['id'] == 'diff'


def test_add_item(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    result = s.add_item('spec', 'Design Spec', '/tmp/spec.md')
    assert result['ok'] is True
    assert result['id'] == 'spec'
    assert len(s.items) == 2
    assert s.items[1]['title'] == 'Design Spec'


def test_add_item_idempotent(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.add_item('spec', 'v1', '/tmp/spec.md')
    s.add_item('spec', 'v2', '/tmp/spec2.md')
    assert len(s.items) == 2
    assert s.items[1]['title'] == 'v2'


def test_add_comments(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    count = s.add_comments('diff', [{'file': 'a.py', 'line': 1, 'comment': 'hi'}])
    assert count == 1
    count = s.add_comments('diff', [{'file': 'b.py', 'line': 2, 'comment': 'hello'}])
    assert count == 2


def test_delete_comment(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.add_comments('diff', [
        {'comment': 'first'},
        {'comment': 'second'},
        {'comment': 'third'},
    ])
    s.delete_comment('diff', 1)
    data = s.get_item_data('diff')
    assert len(data['claudeComments']) == 2
    assert data['claudeComments'][0]['comment'] == 'first'
    assert data['claudeComments'][1]['comment'] == 'third'


def test_delete_comment_out_of_range(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.add_comments('diff', [{'comment': 'only'}])
    s.delete_comment('diff', 5)  # should not crash
    data = s.get_item_data('diff')
    assert len(data['claudeComments']) == 1


def test_clear_comments_by_item(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.add_comments('diff', [{'comment': 'a'}])
    s.add_comments('spec', [{'comment': 'b'}])
    s.clear_comments('diff')
    assert s.get_item_data('diff')['claudeComments'] == []


def test_clear_all_comments(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.add_comments('diff', [{'comment': 'a'}])
    s.add_comments('spec', [{'comment': 'b'}])
    s.clear_comments()
    assert s.get_item_data('diff')['claudeComments'] == []


def test_submit_review(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    round1 = s.submit_review('looks good')
    assert round1 == 1
    round2 = s.submit_review('one more thing')
    assert round2 == 2

    content = Path(s.output_path).read_text()
    assert '# Review Round 1' in content
    assert 'looks good' in content
    assert '# Review Round 2' in content
    assert 'one more thing' in content

    signal = Path(s.output_path + '.signal').read_text()
    assert signal == '2'


def test_get_item_data_diff(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    data = s.get_item_data('diff')
    assert data['mode'] == 'diff'
    assert 'description' in data
    assert data['description'] == 'test'


def test_get_item_data_not_found(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    data = s.get_item_data('nonexistent')
    assert data['mode'] == 'error'


def test_get_item_data_document(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    doc = tmp_path / 'spec.md'
    doc.write_text('# Hello')
    s.add_item('spec', 'Spec', str(doc))
    data = s.get_item_data('spec')
    assert data['mode'] == 'file'
    assert data['content'] == '# Hello'
    assert data['markdown'] is True


def test_sse_subscribe_broadcast(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    q = s.subscribe()
    s.broadcast('test_event', {'key': 'value'})
    msg = q.get_nowait()
    assert msg['event'] == 'test_event'
    assert 'value' in msg['data']


def test_sse_unsubscribe(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    q = s.subscribe()
    s.unsubscribe(q)
    s.broadcast('test', {})
    assert q.empty()


def test_set_analysis(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    analysis = {
        'overview': 'Test PR overview',
        'reviewStrategy': 'Review auth first',
        'files': {
            'auth.py': {
                'priority': 'critical',
                'phase': 'review',
                'summary': 'Core auth logic',
                'category': 'core logic',
            }
        },
        'groups': [
            {'name': 'Auth', 'files': ['auth.py']},
        ],
    }
    s.set_analysis(analysis)
    assert s.analysis == analysis


def test_get_analysis_default_none(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    assert s.analysis is None


def test_set_analysis_replaces(tmp_path: Path) -> None:
    s = make_session(tmp_path)
    s.set_analysis({'overview': 'v1', 'reviewStrategy': '', 'files': {}, 'groups': []})
    s.set_analysis({'overview': 'v2', 'reviewStrategy': '', 'files': {}, 'groups': []})
    assert s.analysis['overview'] == 'v2'
