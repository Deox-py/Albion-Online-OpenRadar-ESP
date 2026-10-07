#!/usr/bin/env python3
"""Offline QA gate for OpenRadar 2.3ESP_Deox.

Runs checks that do not require npm downloads, Npcap, or the Go 1.27 toolchain.
It complements (not replaces) `make qa` on a fully provisioned machine.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILURES: list[str] = []
WARNINGS: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)


def warn(msg: str) -> None:
    WARNINGS.append(msg)


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def check_branding() -> None:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if pkg.get("version") != "2.3.0-esp-deox":
        fail(f"package.json version inesperada: {pkg.get('version')!r}")
    main = (ROOT / "cmd/radar/main.go").read_text(encoding="utf-8")
    if 'Version   = "2.3ESP_Deox"' not in main:
        fail("cmd/radar/main.go no contiene el branding 2.3ESP_Deox")


def has_git_repo() -> bool:
    return (ROOT / ".git").exists()


def check_git_whitespace() -> None:
    if not has_git_repo():
        warn("Paquete sin .git: se omite git diff --check (normal en AutoBuild ZIP)")
        return
    cp = run(["git", "diff", "--check"])
    if cp.returncode:
        fail("git diff --check:\n" + cp.stdout.strip())


def check_go_format() -> None:
    # In a Git checkout only changed Go files are gated. AutoBuild ZIPs omit
    # .git, so gate the full source tree except generated event-code mirrors.
    go_files: list[str] = []
    if has_git_repo():
        cp_status = run(["git", "status", "--porcelain"])
        for line in cp_status.stdout.splitlines():
            rel = line[3:].strip() if len(line) >= 4 else ""
            if rel.endswith(".go") and (ROOT / rel).exists():
                go_files.append(rel)
    else:
        for p in ROOT.rglob("*.go"):
            rel = p.relative_to(ROOT).as_posix()
            if rel.startswith(("node_modules/", ".build/", "dist/")):
                continue
            if rel.startswith("internal/photon/eventcodes/") or rel.startswith("internal/photon/operationcodes/"):
                continue
            go_files.append(rel)
    if not go_files:
        return
    cp = run(["gofmt", "-l", *go_files])
    if cp.returncode:
        fail("gofmt falló:\n" + cp.stdout.strip())
    elif cp.stdout.strip():
        fail("Archivos Go sin formatear:\n" + cp.stdout.strip())


def check_js_syntax() -> None:
    files = [
        p for p in (ROOT / "web/scripts").rglob("*.js")
        if "vendors" not in p.parts
    ]
    for p in files:
        cp = run(["node", "--check", str(p.relative_to(ROOT))])
        if cp.returncode:
            fail(f"Sintaxis JS inválida en {p.relative_to(ROOT)}:\n{cp.stdout.strip()}")


def check_local_imports() -> None:
    import_re = re.compile(r"(?:from\s+|import\s*\()(['\"])([^'\"]+)\1")
    for p in (ROOT / "web/scripts").rglob("*.js"):
        if "vendors" in p.parts:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        for m in import_re.finditer(text):
            spec = m.group(2)
            if not spec.startswith("."):
                continue
            target = (p.parent / spec).resolve()
            candidates = [target]
            if target.suffix == "":
                candidates += [Path(str(target) + ".js"), target / "index.js"]
            if not any(c.exists() for c in candidates):
                fail(f"Import local roto: {p.relative_to(ROOT)} -> {spec}")


def check_template_ids() -> None:
    id_re = re.compile(r'\bid="([^"]+)"')
    for p in (ROOT / "internal/templates").rglob("*.gohtml"):
        ids = id_re.findall(p.read_text(encoding="utf-8", errors="ignore"))
        dups = [k for k, n in Counter(ids).items() if n > 1]
        if dups:
            fail(f"IDs HTML duplicados en {p.relative_to(ROOT)}: {', '.join(dups)}")


def check_template_absolute_modules() -> None:
    module_re = re.compile(r"(?:from\s+|import\s*\()(['\"])(/scripts/[^'\"]+)\1")
    for p in (ROOT / "internal/templates").rglob("*.gohtml"):
        text = p.read_text(encoding="utf-8", errors="ignore")
        for m in module_re.finditer(text):
            spec = m.group(2)
            target = ROOT / "web" / spec.lstrip("/")
            if not target.exists():
                fail(f"Módulo de plantilla inexistente: {p.relative_to(ROOT)} -> {spec}")


def check_profiles() -> None:
    p = ROOT / "web/scripts/utils/RadarProfiles.js"
    if not p.exists():
        fail("Falta RadarProfiles.js")
        return
    text = p.read_text(encoding="utf-8")
    keys = set(re.findall(r"\b(setting[A-Za-z0-9_]+)\s*:", text))
    corpus = "\n".join(
        q.read_text(encoding="utf-8", errors="ignore")
        for base in (ROOT / "web", ROOT / "internal/templates")
        for q in base.rglob("*")
        if q.is_file() and q.suffix in {".js", ".gohtml"} and q != p
    )
    missing = sorted(k for k in keys if k not in corpus)
    if missing:
        fail("Perfiles escriben settings sin consumidores conocidos: " + ", ".join(missing))


def check_common_untranslated_ui() -> None:
    # Conservative list: only obvious visible phrases that should not remain in the Spanish fork.
    phrases = [
        "Connected to radar backend", "Connection lost", "Danger Zone",
        "Capture interfaces", "Resource Count", "Distance Indicator",
        "Ignore List", "Browser Console (F12)", "Download settings and session info",
    ]
    for p in (ROOT / "internal/templates").rglob("*.gohtml"):
        text = p.read_text(encoding="utf-8", errors="ignore")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for phrase in phrases:
            if phrase in text:
                fail(f"Texto UI inglés residual en {p.relative_to(ROOT)}: {phrase!r}")
    for p in (ROOT / "web/scripts").rglob("*.js"):
        if "vendors" in p.parts or p.name.endswith(".test.js"):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        text = re.sub(r"//.*", "", text)
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        for phrase in phrases[:2]:
            if phrase in text:
                fail(f"Toast UI inglés residual en {p.relative_to(ROOT)}: {phrase!r}")


def check_portable_release() -> None:
    prod = (ROOT / "embed_prod.go").read_text(encoding="utf-8")
    required_embeds = [
        "all:web/images", "web/scripts", "all:web/ao-bin-dumps",
        "all:web/sounds", "all:web/styles", "all:internal/templates",
    ]
    for marker in required_embeds:
        if marker not in prod:
            fail(f"Portable incompleto: falta go:embed para {marker}")

    main = (ROOT / "cmd/radar/main.go").read_text(encoding="utf-8")
    for marker in [
        'LOCALAPPDATA', 'OpenRadar-2.3ESP_Deox', 'openBrowser(',
        'npcapRuntimePresent()', 'no-open',
    ]:
        if marker not in main:
            fail(f"Portable incompleto: falta marcador {marker!r} en main.go")


def check_required_files() -> None:
    required = [
        "web/scripts/utils/DisplayMode.js",
        "web/scripts/utils/RadarProfiles.js",
        "web/scripts/utils/_DisplayMode.test.js",
        "web/scripts/utils/_RadarProfiles.test.js",
        "web/scripts/utils/_WebSocketEventQueue.test.js",
        "internal/server/websocket_hardening_test.go",
    ]
    for rel in required:
        if not (ROOT / rel).exists():
            fail(f"Falta archivo esperado: {rel}")



def check_incremental_builder_contract() -> None:
    ps = (ROOT / "AUTO-BUILD-2.3ESP_Deox.ps1").read_text(encoding="utf-8")
    required = [
        "%LOCALAPPDATA%" if False else "OpenRadar-Deox\\build-cache",
        "$NpmCacheDir",
        "--prefer-offline",
        "--no-audit",
        "--fund=false",
        "frontend-lock.sha256",
        "go-modules.sha256",
        "MinGW-w64 OK (cache)",
        "Npcap SDK OK",
        "[switch]$Clean",
    ]
    for marker in required:
        if marker not in ps:
            fail(f"Builder incremental incompleto: falta {marker!r}")

    if "Remove-Item $BuildDir -Recurse" in ps or "        $BuildDir,\n        $SharedCacheRoot" in ps:
        fail("Builder -Clean intenta borrar .build completo durante un transcript activo")

    smoke_pos = ps.find("Smoke funcional offline V7.1")
    mingw_pos = ps.find("$gcc = Ensure-Mingw")
    if smoke_pos < 0 or mingw_pos < 0 or smoke_pos > mingw_pos:
        fail("El smoke offline debe ejecutarse antes de preparar MSYS2/MinGW")

    dungeons = (ROOT / "web/scripts/handlers/DungeonsHandler.js").read_text(encoding="utf-8")
    priority = "const name = legacyName || dragonfireName || knightfallName;"
    if priority not in dungeons:
        fail("DungeonsHandler no conserva Parameters[3] como prioridad antes de fallbacks Mist")

    # V7.1.1 regression guard: GCC must receive the MinGW runtime PATH before
    # being probed, and the probe must compile/link real C code (not only --version).
    add_path_pos = ps.find("Add-MingwPath $localMsysRoot")
    cached_probe_pos = ps.find("Test-MingwCompiler $localMsysRoot $localGcc")
    if add_path_pos < 0 or cached_probe_pos < 0 or add_path_pos > cached_probe_pos:
        fail("Builder vuelve a probar GCC antes de exponer mingw64/bin en PATH")
    for marker in ["function Test-MingwCompiler", "probe.c", "int main(void){return 0;}", "mingw-w64-x86_64-gcc-libs"]:
        if marker not in ps:
            fail(f"Falta guardia V7.1.1 del toolchain MinGW: {marker}")

    # V7.1.2 regression guard: the .mjs smoke harness is linted as a mixed
    # Node/browser environment, otherwise ESLint no-undef rejects the mocks.
    eslint_cfg = (ROOT / "eslint.config.mjs").read_text(encoding="utf-8")
    for marker in ['tools/**/*.{js,mjs}', 'tools/qa-v7-smoke.mjs', '...globals.node', '...globals.browser']:
        if marker not in eslint_cfg:
            fail(f"ESLint smoke harness incompleto: falta {marker!r}")

    clean_bat = ROOT / "COMPILAR-LIMPIO.bat"
    if not clean_bat.exists() or "-Clean" not in clean_bat.read_text(encoding="utf-8", errors="ignore"):
        fail("Falta COMPILAR-LIMPIO.bat funcional con -Clean")

def main() -> int:
    checks = [
        check_branding,
        check_git_whitespace,
        check_go_format,
        check_js_syntax,
        check_local_imports,
        check_template_ids,
        check_template_absolute_modules,
        check_profiles,
        check_common_untranslated_ui,
        check_portable_release,
        check_required_files,
        check_incremental_builder_contract,
    ]
    for check in checks:
        try:
            check()
        except Exception as exc:
            fail(f"{check.__name__} lanzó {type(exc).__name__}: {exc}")

    print(f"QA estático 2.3ESP_Deox: {len(checks)} grupos de checks")
    for w in WARNINGS:
        print(f"WARN: {w}")
    if FAILURES:
        print(f"FALLOS: {len(FAILURES)}")
        for f in FAILURES:
            print(f"- {f}")
        return 1
    print("OK: todos los checks estáticos pasaron")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
