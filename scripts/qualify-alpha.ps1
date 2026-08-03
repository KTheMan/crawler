[CmdletBinding()]
param(
    [switch]$BrowserEvidence,
    [switch]$SkipBrowserSuites
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedKernel = 'e9024ba7d6bff2b8407cd382dd584f784bfa7abe'
$previousTarget = $env:CARGO_TARGET_DIR
$env:CARGO_TARGET_DIR = Join-Path $root 'target\alpha-qualification'

function Invoke-Step {
    param(
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [scriptblock]$Command
    )
    Write-Host "`n==> $Label" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

try {
    Push-Location $root

    Invoke-Step 'Verify pinned kernel and clean vendor worktree' {
        $actual = (git -C vendor/monstertruck rev-parse HEAD).Trim()
        if ($actual -ne $expectedKernel) {
            throw "Monstertruck pin differs: expected $expectedKernel, got $actual"
        }
        $vendorStatus = git -C vendor/monstertruck status --porcelain
        if ($vendorStatus) {
            throw "Monstertruck worktree is not clean:`n$vendorStatus"
        }
    }

    Invoke-Step 'Run native workspace contracts' {
        cargo test --workspace
    }
    Invoke-Step 'Run workspace lint gate' {
        cargo clippy --workspace --all-targets -- -D warnings
    }

    foreach ($crate in @('crawler-kernel-worker', 'crawler-render-packet', 'crawler-part-runtime')) {
        Invoke-Step "Compile $crate contracts for wasm32" {
            cargo test -p $crate --target wasm32-unknown-unknown --no-run
        }
    }

    Invoke-Step 'Regenerate worker and renderer contract bindings' {
        & (Join-Path $PSScriptRoot 'generate-contract-bindings.ps1')
    }

    Invoke-Step 'Run document protocol mirror' {
        node --experimental-strip-types --test web/document-protocol/test/*.test.ts
    }
    Invoke-Step 'Run operation schema mirror' {
        node --experimental-strip-types --test web/operation-schema/test/*.test.ts
    }
    Invoke-Step 'Run storage and recovery mirror' {
        node --test web/storage-protocol/test/*.test.mjs
    }
    Invoke-Step 'Run generated-WASM worker contracts' {
        node --test web/worker-spike/worker-spike.test.mjs
    }
    Invoke-Step 'Run alpha application unit contracts' {
        pnpm --dir web/crawler-app test:unit
    }

    if (-not $SkipBrowserSuites) {
        Invoke-Step 'Regenerate alpha application WASM binding' {
            & (Join-Path $PSScriptRoot 'generate-part-runtime.ps1')
        }
        Invoke-Step 'Build renderer spike' {
            pnpm --dir spikes/e00-s03-renderer build
        }
        Invoke-Step 'Run renderer browser contracts' {
            pnpm --dir spikes/e00-s03-renderer test
        }
        Invoke-Step 'Build alpha application' {
            pnpm --dir web/crawler-app build
        }
        Invoke-Step 'Run alpha browser workflow contracts' {
            pnpm --dir web/crawler-app test
        }
    }

    if ($BrowserEvidence) {
        Invoke-Step 'Measure M1 worker in Chrome' {
            node scripts/measure-worker-browser.mjs
        }
    }

    Write-Host "`nCrawler alpha qualification passed." -ForegroundColor Green
}
finally {
    Pop-Location
    $env:CARGO_TARGET_DIR = $previousTarget
}
