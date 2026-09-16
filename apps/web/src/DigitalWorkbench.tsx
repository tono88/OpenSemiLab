import { useEffect, useState } from 'react'

const DEFAULT_RTL = `module top (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [7:0] gpio_in,
  output logic [7:0] gpio_out
);
  logic [7:0] counter;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      counter  <= 8'h00;
      gpio_out <= 8'h00;
    end else begin
      counter  <= counter + 1'b1;
      gpio_out <= counter ^ gpio_in;
    end
  end
endmodule
`

const DEFAULT_TB = `\`timescale 1ns/1ps
module tb;
  logic clk = 0;
  logic rst_n = 0;
  logic [7:0] gpio_in = 8'hA5;
  logic [7:0] gpio_out;

  top dut (.*);
  always #5 clk = ~clk;

  initial begin
    $display("OpenSemiLab simulation started");
    #12 rst_n = 1;
    repeat (8) begin
      @(posedge clk);
      $display("t=%0t gpio_out=%02h", $time, gpio_out);
    end
    $display("PASS");
    $finish;
  end
endmodule
`

interface RunResult { job_id: string; action: string; engine: string; success: boolean; exit_code: number; output: string; duration_ms: number; artifacts: {name:string;media_type:string;content:string}[] }

export default function DigitalWorkbench() {
  const [rtl, setRtl] = useState(DEFAULT_RTL)
  const [testbench, setTestbench] = useState(DEFAULT_TB)
  const [worker, setWorker] = useState<'checking'|'online'|'offline'>('checking')
  const [tools, setTools] = useState<Record<string,{available:boolean}>>({})
  const [running, setRunning] = useState('')
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState('')

  async function refresh() {
    setWorker('checking')
    try { const r=await fetch('/api/v1/eda/capabilities'); if(!r.ok) throw new Error(); const body=await r.json(); setTools(body.tools); setWorker('online') }
    catch { setWorker('offline') }
  }
  useEffect(()=>{void refresh()},[])

  async function run(action:'lint'|'simulate'|'synthesize') {
    setRunning(action); setError(''); setResult(null)
    const body={action,top:action==='simulate'?'tb':'top',sources:action==='simulate'?{'design.sv':rtl,'tb.sv':testbench}:{'design.sv':rtl}}
    try { const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await response.json(); if(!response.ok) throw new Error(data.detail??'EDA execution failed'); setResult(data) }
    catch(reason){setError(reason instanceof Error?reason.message:'EDA execution failed')}
    finally{setRunning('')}
  }

  function download(artifact:{name:string;media_type:string;content:string}) {
    const url=URL.createObjectURL(new Blob([artifact.content],{type:artifact.media_type})); const link=document.createElement('a'); link.href=url; link.download=artifact.name; link.click(); URL.revokeObjectURL(url)
  }

  return <section className="workbench">
    <div className="section-heading"><span>04</span><div><h2>RTL workbench</h2><p>Edit real SystemVerilog and execute command-line tools inside IIC-OSIC-TOOLS.</p></div></div>
    <div className={`worker-state ${worker}`}><i/>{worker==='online'?'IIC-OSIC worker online':worker==='checking'?'Checking IIC-OSIC worker…':'Worker offline — rebuild the Docker stack to enable execution'}<button onClick={refresh}>Check again</button></div>
    <div className="editor-grid"><label><span>design.sv · synthesized design</span><textarea value={rtl} onChange={e=>setRtl(e.target.value)} spellCheck={false}/></label><label><span>tb.sv · simulation testbench</span><textarea value={testbench} onChange={e=>setTestbench(e.target.value)} spellCheck={false}/></label></div>
    <div className="action-bar"><button disabled={worker!=='online'||!!running} onClick={()=>run('lint')}><span>01</span>{running==='lint'?'Running…':'Lint RTL'}<small>{tools.verible_lint?.available?'Verible':'Verilator'}</small></button><button disabled={worker!=='online'||!!running} onClick={()=>run('simulate')}><span>02</span>{running==='simulate'?'Running…':'Simulate'}<small>Icarus Verilog</small></button><button disabled={worker!=='online'||!!running} onClick={()=>run('synthesize')}><span>03</span>{running==='synthesize'?'Running…':'Synthesize'}<small>Yosys</small></button></div>
    {error&&<p className="error">{error}</p>}
    {result&&<div className="console"><div><span>{result.engine} · job {result.job_id} · {result.duration_ms} ms</span><b className={result.success?'success':'failed'}>{result.success?'PASSED':'FAILED'} · EXIT {result.exit_code}</b></div><pre>{result.output||'Command completed without console output.'}</pre>{result.artifacts.map(artifact=><button key={artifact.name} onClick={()=>download(artifact)}>Download {artifact.name} ↓</button>)}</div>}
  </section>
}
