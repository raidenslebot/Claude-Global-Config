# MANDATORY Python Tooling Stack — uv

For ANY Python work — a one-file script, a project, a tool you need to run once, an existing
`requirements.txt`, a notebook's dependencies — use **uv**. It replaces `pip`, `pip-tools`,
`pipx`, `pyenv`, `virtualenv`, `build` and `twine`, and on Windows it is the only one of those
that manages interpreters at all.

Apache-2.0 OR MIT. No account, no API key, no telemetry. `uv publish` is the only command that
ever needs a credential, and only when you publish.

## The commands, by what you are actually doing

**Run something once, without installing it.**

```bash
uvx ruff check                      # ephemeral, cached, gone on `uv cache clean`
uvx --from httpie http              # when the command name differs from the package
uvx ruff@0.5.0 check                # pin the tool, not the environment
```

**A single file that needs dependencies.** This is uv's one genuinely new idea, and it has no
pip, pipx or poetry equivalent: PEP 723 metadata inside the script, so the file itself is the
reproducible artifact.

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests<3", "rich"]
# ///

import requests
from rich.pretty import pprint
pprint(requests.get("https://peps.python.org/api/peps.json").json())
```

```bash
uv init --script tool.py --python 3.12    # write the header for me
uv add --script tool.py 'requests<3'      # edit it in place, sorted
uv lock --script tool.py                  # -> tool.py.lock, pinned
uv run tool.py                            # resolve + run, no venv to think about
uv run --with rich tool.py                # one-off extra, not recorded
```

**A project.**

```bash
uv init myapp && cd myapp
uv add requests            # writes pyproject.toml, uv.lock, .venv
uv add --dev pytest        # dependency-groups, not published
uv run pytest              # auto-syncs first — see the traps
uv tree                    # what actually resolved
uv export --format requirements.txt   # the escape hatch back to pip
```

**Interpreters.** uv downloads and manages them itself, which is the biggest Windows win here —
pyenv does not work on Windows at all.

```bash
uv python install 3.12 3.13
uv python pin 3.11            # writes .python-version
uv python list
```

**The pip-compatible surface**, for an existing requirements workflow you are not migrating yet:

```bash
uv venv && uv pip install -r requirements.txt
uv pip compile requirements.in --universal -o requirements.txt
uv pip sync requirements.txt
```

## The traps — every one of these was reproduced, not read

1. **`uv version` is not uv's version.** It reads the *project's* version from `pyproject.toml`
   and fails outside a project. Any script, hook or doctor check must use **`uv --version`**
   (prints `uv 0.12.5 (210d1f678 2026-08-14 x86_64-pc-windows-msvc)`) or `uv self version
   --short` (prints `0.12.5`).

2. **`uv sync` deletes packages it did not install.** A `uv pip install` into a project's own
   `.venv` is removed by the next `uv sync` — and `uv run` syncs first, so it vanishes on the
   next test run:
   ```
   $ uv pip install charset-normalizer   ->  + charset-normalizer==3.5.1
   $ uv sync                             ->  - charset-normalizer==3.5.1
   ```
   Use `uv add` for anything that should persist, or `uv sync --inexact` to leave extras alone.

3. **`uv run` auto-syncs and can rewrite `uv.lock` as a side effect of running your tests.** In
   CI that means CI can change the lockfile and still pass. Pass **`--locked`** (error if the
   lockfile is stale) or `--frozen` (use it as-is) in any automated context.

4. **The two halves of uv disagree about which environment you mean.** Project commands ignore
   `VIRTUAL_ENV` and warn; `uv pip` honours it *silently*. So in one shell `uv run` targets
   `.venv` and `uv pip install` targets somewhere else, and only one of them tells you. Read the
   `Using Python … environment at:` line, or set `UV_PROJECT_ENVIRONMENT`, or do not mix them.

5. **`uv pip` walks up to a parent `.venv`.** Run it from a subdirectory of a monorepo and it
   installs into whichever `.venv` is nearest above you.

6. **It will not touch the system Python without `--system`,** deliberately. Every `pip install X`
   reflex fails on first contact until there is a venv. `--user` is not supported at all.

7. **It reads none of pip's configuration** — no `pip.conf`, no `PIP_INDEX_URL`. A corporate
   mirror has to be redeclared as `UV_INDEX_URL` / `[[tool.uv.index]]`. This is the commonest
   silent breakage when dropping uv into an existing setup.

8. **Multi-index resolution differs, on purpose.** uv stops at the first index carrying the name
   (anti-dependency-confusion) where pip merges across all of them, so a package can resolve
   differently or not at all. Pin it with `[tool.uv.sources] pkg = { index = "name" }` rather
   than reaching for `--index-strategy=unsafe-best-match`, which re-opens the hole.

9. **Automatic Python downloads are a surprise on a locked-down machine** — `uvx`, `uv venv` and
   `uv run` will each fetch a ~30MB interpreter with no prompt. `--no-python-downloads` or
   `UV_PYTHON_DOWNLOADS=never`.

10. **Versioning is not semver.** A `0.12.x` → `0.13.x` bump is a *breaking* change by their own
    policy. Pin the installer (`https://astral.sh/uv/<version>/install.ps1`), not `latest`.

11. **Bytecode is not compiled by default** — set `UV_COMPILE_BYTECODE=1` if startup time matters.

12. **A build failure is almost never uv's fault.** It comes from the build backend; reproduce it
    with `pip --use-pep517` before blaming uv. The usual cause is an old pinned version with no
    wheel for your Python — and uv's universal lockfile makes it worse, because it resolves for
    *every* platform in range and can be forced to build an sdist for one you never use.

## Install and verify

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Lands `uv.exe`, `uvx.exe`, `uvw.exe` in `%USERPROFILE%\.local\bin`. Cache in
`%LOCALAPPDATA%\uv\cache`; tools in `%APPDATA%\uv\tools`; managed interpreters in
`%APPDATA%\uv\python`. `uv cache prune --ci` at the end of a CI job.

## Order of operations

1. `uv --version` — confirm it is there before assuming any of the above.
2. Choose the shape: a script gets PEP 723 metadata; anything with more than one file gets
   `uv init`. Do not create a bare `.venv` + `requirements.txt` for new work.
3. `uv add` / `uv add --script` for anything that must persist. Never `uv pip install` into a
   project you also `uv run`.
4. `uv lock` and commit `uv.lock`. In CI, `uv run --locked`.
5. Only then claim the work runs.
