from pathlib import Path
from unittest.mock import patch

from git_ops import detect_base_branch, get_file_lines


def test_get_file_lines_down(tmp_path: Path) -> None:
    f = tmp_path / 'test.py'
    f.write_text('line1\nline2\nline3\nline4\nline5')
    lines = get_file_lines(str(tmp_path), 'test.py', 0, 3)
    assert len(lines) == 3
    assert lines[0] == {'num': 1, 'content': 'line1'}
    assert lines[2] == {'num': 3, 'content': 'line3'}


def test_get_file_lines_up(tmp_path: Path) -> None:
    f = tmp_path / 'test.py'
    f.write_text('line1\nline2\nline3\nline4\nline5')
    lines = get_file_lines(str(tmp_path), 'test.py', 4, 2, direction='up')
    assert len(lines) == 2
    assert lines[0] == {'num': 2, 'content': 'line2'}
    assert lines[1] == {'num': 3, 'content': 'line3'}


def test_get_file_lines_missing_file(tmp_path: Path) -> None:
    lines = get_file_lines(str(tmp_path), 'nope.py', 0, 10)
    assert lines == []


def test_detect_base_branch_main(tmp_path: Path) -> None:
    with patch('git_ops.subprocess.run') as mock_run:
        # First call (master) fails, second (main) succeeds
        mock_run.side_effect = [
            type('Result', (), {'returncode': 1})(),
            type('Result', (), {'returncode': 0})(),
        ]
        assert detect_base_branch(str(tmp_path)) == 'main'


def test_detect_base_branch_fallback(tmp_path: Path) -> None:
    with patch('git_ops.subprocess.run') as mock_run:
        mock_run.return_value = type('Result', (), {'returncode': 1})()
        assert detect_base_branch(str(tmp_path)) == 'master'
