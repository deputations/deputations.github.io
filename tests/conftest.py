"""Shared pytest fixtures for the deputation smoke suite (P3-4).

One session-scoped HTTP server serves the repo root. Each test gets a fresh
browser context with the Supabase routes stubbed (no real backend) and the
homepage theme seeded.
"""
from __future__ import annotations

import socket
import threading
from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

from tests.fixtures.constants import ANON_KEY, REPO_ROOT, SUPA_HOST, TEST_PORT
from tests.fixtures.rpc_stub import install as install_rpc_stub
from tests.pages.serve import serve

ARTIFACTS = REPO_ROOT / "tests" / "_artifacts"


def _pick_port(preferred: int) -> int:
    """Bind to `preferred` if it's free, else let the OS pick."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", preferred))
        return s.getsockname()[1]
    except OSError:
        s.close()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port


@pytest.fixture(scope="session")
def base_url() -> str:
    """Static HTTP server hosting the repo, run once for the session."""
    port = _pick_port(TEST_PORT)
    server, thread = serve(REPO_ROOT, port)
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def browser() -> Browser:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture()
def context(browser: Browser, request: pytest.FixtureRequest) -> BrowserContext:
    ctx = browser.new_context()
    ctx.add_init_script(
        # Seed theme so paint is deterministic and we don't depend on defaultTheme logic.
        "try { localStorage.setItem('deputation_theme_v1', 'dark'); } catch(e) {}"
    )
    yield ctx
    ctx.close()


@pytest.fixture()
def page(context: BrowserContext, base_url: str, request: pytest.FixtureRequest) -> Page:
    """A page with the Supabase route stubs installed and tracing enabled.

    On test failure, screenshots and a trace zip are written into `tests/_artifacts/`
    so CI can upload them. The `_failed` flag is set by `pytest_runtest_makereport`
    below.
    """
    p = context.new_page()
    p.set_default_timeout(15000)
    install_rpc_stub(p, anon_key=ANON_KEY)

    tracing_path = ARTIFACTS / f"{request.node.name}.trace.zip"
    context.tracing.start(screenshots=True, snapshots=True, sources=False)
    try:
        yield p
    finally:
        context.tracing.stop(path=str(tracing_path))
        if getattr(request.node, "_failed", False):
            shot = ARTIFACTS / f"{request.node.name}.png"
            p.screenshot(path=str(shot), full_page=True)
        p.close()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):  # noqa: ARG001 (pytest signature)
    """Stash a `_failed` flag on the test node so fixtures can detect failures."""
    outcome = yield
    rep = outcome.get_result()
    if rep.failed:
        item._failed = True
