import { SYMBOLS } from "./quotes.js";

export function renderDemoPage(feePayer: string, network: string, hasUsdc: boolean): string {
  const symbolButtons = SYMBOLS.map((s) => `<button class="symbol" data-symbol="${s}">${s}</button>`).join("");
  const assetToggle = hasUsdc
    ? `<div class="assets">
        <button class="asset active" data-asset="hbar">Pay with HBAR</button>
        <button class="asset" data-asset="usdc">Pay with tUSDC (demo HTS token)</button>
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>hedera-x402-facilitator — live demo</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 2.5rem 1.25rem 4rem;
    background: #0a0e14; color: #e6edf3;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center;
  }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .sub { color: #8b949e; margin: 0 0 2rem; font-size: 0.95rem; }
  .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.75rem;
    background: #1f6feb22; color: #58a6ff; border: 1px solid #1f6feb55; margin-left: 0.5rem; }
  .card { background: #10151d; border: 1px solid #21262d; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.25rem; }
  .symbols { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
  button.symbol { background: #161b22; border: 1px solid #30363d; color: #e6edf3; padding: 0.6rem 1.1rem;
    border-radius: 8px; font-size: 0.95rem; cursor: pointer; font-weight: 600; }
  button.symbol.active { background: #1f6feb; border-color: #1f6feb; }
  .assets { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
  button.asset { background: #161b22; border: 1px solid #30363d; color: #8b949e; padding: 0.5rem 0.9rem;
    border-radius: 8px; font-size: 0.85rem; cursor: pointer; font-weight: 600; }
  button.asset.active { background: #9e6a03; border-color: #9e6a03; color: white; }
  button#run { width: 100%; padding: 0.85rem; border-radius: 8px; border: none; font-size: 1rem; font-weight: 700;
    background: #238636; color: white; cursor: pointer; }
  button#run:disabled { opacity: 0.6; cursor: wait; }
  .steps { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.65rem; }
  .step { opacity: 0; transform: translateY(6px); animation: in 0.35s ease forwards; padding: 0.75rem 0.9rem;
    background: #0d1117; border: 1px solid #21262d; border-radius: 8px; font-size: 0.9rem; }
  .step .label { font-weight: 700; color: #7ee787; }
  .step .detail { color: #8b949e; margin-top: 0.2rem; word-break: break-word; }
  @keyframes in { to { opacity: 1; transform: none; } }
  .result { margin-top: 1.25rem; padding: 1rem; background: #0d1117; border: 1px solid #238636; border-radius: 8px; }
  .result .price { font-size: 1.8rem; font-weight: 800; }
  a.hashscan { display: inline-block; margin-top: 0.6rem; color: #58a6ff; text-decoration: none; font-weight: 600; }
  a.hashscan:hover { text-decoration: underline; }
  .error { color: #f85149; }
  footer { margin-top: 2rem; color: #6e7681; font-size: 0.8rem; text-align: center; }
  footer a { color: #6e7681; }
  code { background: #161b22; padding: 0.1rem 0.35rem; border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>hedera-x402-facilitator<span class="badge">live · ${network}</span></h1>
  <p class="sub">Self-hostable x402 facilitator for Hedera. This page runs a real autonomous-agent purchase against it — every step below is a genuine HTTP round trip and a real testnet transaction.</p>

  <div class="card">
    <div class="symbols">${symbolButtons}</div>
    ${assetToggle}
    <button id="run">Buy this quote with a Hedera agent</button>
    <div class="steps" id="steps"></div>
    <div id="result"></div>
  </div>

  <p class="sub">Facilitator fee-payer: <code>${feePayer}</code> · Reference architecture: agent pays per query (<a href="https://x402.org" style="color:#58a6ff">x402</a> spec)</p>

  <footer>
    <a href="https://github.com/BelgacemElbar/hedera-x402-facilitator">source on GitHub</a> ·
    facilitator API: <code>POST /verify</code> · <code>POST /settle</code> · <code>GET /supported</code>
  </footer>
</main>
<script>
  let symbol = "${SYMBOLS[0]}";
  let asset = "hbar";
  document.querySelectorAll(".symbol").forEach((btn, i) => {
    if (i === 0) btn.classList.add("active");
    btn.addEventListener("click", () => {
      document.querySelectorAll(".symbol").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      symbol = btn.dataset.symbol;
    });
  });
  document.querySelectorAll(".asset").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".asset").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      asset = btn.dataset.asset;
    });
  });

  const runBtn = document.getElementById("run");
  const stepsEl = document.getElementById("steps");
  const resultEl = document.getElementById("result");

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    runBtn.textContent = "Running the x402 flow...";
    stepsEl.innerHTML = "";
    resultEl.innerHTML = "";

    try {
      const res = await fetch("/demo/run?symbol=" + encodeURIComponent(symbol) + "&asset=" + encodeURIComponent(asset), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      data.steps.forEach((step, i) => {
        const div = document.createElement("div");
        div.className = "step";
        div.style.animationDelay = (i * 0.15) + "s";
        div.innerHTML = '<div class="label">' + (i + 1) + ". " + step.label + '</div><div class="detail">' + step.detail + "</div>";
        stepsEl.appendChild(div);
      });

      if (data.quote) {
        const box = document.createElement("div");
        box.className = "result";
        box.innerHTML = '<div class="price">' + data.quote.symbol + " $" + data.quote.price + '</div><div class="sub" style="margin:0.2rem 0 0">as of ' + new Date(data.quote.asOf).toLocaleTimeString() + "</div>" +
          (data.hashscanUrl ? '<a class="hashscan" href="' + data.hashscanUrl + '" target="_blank">View real transaction on HashScan →</a>' : "");
        resultEl.appendChild(box);
      }
    } catch (err) {
      resultEl.innerHTML = '<div class="error">' + (err.message || String(err)) + "</div>";
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Buy this quote with a Hedera agent";
    }
  });
</script>
</body>
</html>`;
}
