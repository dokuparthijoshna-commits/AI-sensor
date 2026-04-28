import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ── Config ───────────────────────────────────────────────────────────────────
const SERVER = "https://ai-sensor.onrender.com";  // Your laptop IP - change if needed

// ── Simulation fallback (used when server is offline) ────────────────────────
function generateFake(forceAnomaly = false) {
  const pick = Math.floor(Math.random() * 2);
  if (forceAnomaly) return {
    temp:     pick === 0 ? +(55 + Math.random() * 20).toFixed(1) : +(24 + Math.random() * 6).toFixed(1),
    humidity: pick === 1 ? +(5  + Math.random() * 10).toFixed(1) : +(45 + Math.random() * 20).toFixed(1),
  };
  return {
    temp:     +(24 + Math.random() * 8).toFixed(1),
    humidity: +(45 + Math.random() * 25).toFixed(1),
  };
}

function localDetect(d) {
  const r = [];
  if (d.temp > 50 || d.temp < 5)      r.push(`Temp ${d.temp}°C`);
  if (d.humidity > 85 || d.humidity < 15) r.push(`Humidity ${d.humidity}%`);
  return { isAnomaly: r.length > 0, reasons: r };
}

// ── Gauge ─────────────────────────────────────────────────────────────────────
const Gauge = ({ value, min, max, unit, label, anomaly, color }) => {
  const pct   = Math.min(Math.max((value - min) / (max - min), 0), 1);
  const angle = -135 + pct * 270;
  const r = 50, cx = 70, cy = 70;
  const toXY = (deg) => ({ x: cx + r * Math.cos(deg * Math.PI / 180), y: cy + r * Math.sin(deg * Math.PI / 180) });
  const start   = toXY(-135), end = toXY(angle), trackEnd = toXY(135);
  const largeArc = pct > 0.5 ? 1 : 0;
  const dot = { x: cx + (r-4)*Math.cos(angle*Math.PI/180), y: cy + (r-4)*Math.sin(angle*Math.PI/180) };
  const c = anomaly ? "#ef4444" : color;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"8px" }}>
      <svg width={140} height={110} viewBox="0 0 140 110">
        <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${trackEnd.x} ${trackEnd.y}`}
          fill="none" stroke="#1e293b" strokeWidth={10} strokeLinecap="round"/>
        {pct > 0 && <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
          fill="none" stroke={c} strokeWidth={10} strokeLinecap="round"
          style={{ filter:`drop-shadow(0 0 8px ${c})`, transition:"all 0.5s ease" }}/>}
        <circle cx={dot.x} cy={dot.y} r={6} fill={c} style={{ filter:`drop-shadow(0 0 4px ${c})`, transition:"all 0.5s ease" }}/>
        <text x={cx} y={cy+8}  textAnchor="middle" fill={c} fontSize={22} fontWeight="bold">{value}</text>
        <text x={cx} y={cy+24} textAnchor="middle" fill="#94a3b8" fontSize={12} fontWeight="500">{unit}</text>
      </svg>
      <span style={{ fontSize:"14px", color:"#94a3b8", fontWeight:"600", letterSpacing:"1px", textTransform:"uppercase" }}>{label}</span>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode,       setMode]       = useState("connecting"); // connecting | live | offline
  const [current,   setCurrent]    = useState({ temp:27, humidity:55 });
  const [anomaly,   setAnomaly]    = useState({ isAnomaly:false, reasons:[] });
  const [history,   setHistory]    = useState([]);
  const [log,       setLog]        = useState([]);
  const [stats,     setStats]      = useState({ total:0, faults:0 });
  const [fakeMode,  setFakeMode]   = useState(false);
  const [injectFault, setInjectFault] = useState(false);
  const [source,    setSource]     = useState("real");
  const [lastUpdate, setLastUpdate] = useState(null);
  const tick = useRef(0);

  // ── Try server, fallback to sim ───────────────────────────────────────────
  useEffect(() => {
    let interval;

    const poll = async () => {
      tick.current += 1;
      if (!fakeMode) {
        try {
          const res  = await fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(2000) });
          const data = await res.json();
          if (data.status === "Waiting" || !data.data?.temp) {
             setMode("connecting");
             return;
          }

          const d  = data.data;
          const isA = data.status === "Anomaly";
          const reasons = data.anomaly_reason || [];
          setMode("live");
          setCurrent({ temp: +d.temp, humidity: +d.humidity });
          setAnomaly({ isAnomaly: isA, reasons });
          setSource(data.source || "real");
          addReading(d, isA, data.source || "real");
        } catch {
          setMode("offline");
          runSim();
        }
      } else {
        runSim();
      }
    };

    const runSim = async () => {
      const d = generateFake(injectFault);
      const det = localDetect(d);
      setCurrent(d);
      setAnomaly(det);
      setSource("simulated");

      // Send simulated data to server
      try {
        await fetch(`${SERVER}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...d, source: "simulated" })
        });
      } catch (e) {
        // Ignore if server offline
      }

      addReading(d, det.isAnomaly, "simulated");
    };

    const addReading = (d, isA, src) => {
      const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
      setLastUpdate(timeStr);
      setHistory(h => [...h, { ...d, tick: tick.current, anomaly: isA }].slice(-30));
      setLog(l => [{ ...d, isAnomaly: isA, time: timeStr, source: src }, ...l].slice(0, 15));
      setStats(s => ({ total: s.total + 1, faults: s.faults + (isA ? 1 : 0) }));
    };

    interval = setInterval(poll, 2000);
    poll();
    return () => clearInterval(interval);
  }, [fakeMode, injectFault]);

  const faultRate = stats.total > 0 ? ((stats.faults / stats.total) * 100).toFixed(1) : "0.0";

  const isSimData = source === "simulated";
  
  // Clean connection status banner
  let statusBanner;
  if (mode === "live" && !isSimData) {
    statusBanner = {
      text: "🟢 HARDWARE CONNECTED: Receiving Real Sensor Data",
      color: "#10b981", // emerald
      bg: "#064e3b"
    };
  } else if (mode === "live" && isSimData) {
    statusBanner = {
      text: "🧪 LIVE SERVER: Receiving Simulated Data",
      color: "#f59e0b", // amber
      bg: "#78350f"
    };
  } else {
    statusBanner = {
      text: "🔴 SERVER OFFLINE: Using Local Simulation Fallback",
      color: "#ef4444", // red
      bg: "#7f1d1d"
    };
  }

  return (
    <div style={{ minHeight:"100vh", padding:"30px 40px", maxWidth:"1200px", margin:"0 auto" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.1)}}
      `}</style>

      {/* Header Area */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", flexWrap: "wrap", gap: "20px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "14px", color: "#64748b", fontWeight: "600", textTransform: "uppercase", letterSpacing: "1px" }}>
            Smart Environment Monitor
          </h2>
          <h1 style={{ margin: "5px 0 0 0", fontSize: "32px", fontWeight: "700", color: "#f8fafc", letterSpacing: "-0.5px" }}>
            Hybrid AI Fault Detection System
          </h1>
        </div>
        <div style={{ display:"flex", gap:"12px" }}>
          <button className="btn"
            onClick={() => { setFakeMode(f => !f); setInjectFault(false); }}
            style={{ background: fakeMode ? "rgba(245, 158, 11, 0.15)":"#1e293b", color: fakeMode ? "#fbbf24":"#cbd5e1", border:`1px solid ${fakeMode?"rgba(245, 158, 11, 0.3)":"#334155"}` }}>
            {fakeMode ? "🔌 Switch to Real Hardware" : "🖥️ Switch to Simulation"}
          </button>
          <button className="btn"
            onClick={() => setInjectFault(f => !f)}
            style={{ background: injectFault ? "rgba(239, 68, 68, 0.15)":"#1e293b", color: injectFault ? "#f87171":"#cbd5e1", border:`1px solid ${injectFault?"rgba(239, 68, 68, 0.3)":"#334155"}` }}>
            {injectFault ? "🔴 Stop Fault Injection" : "⚠️ Inject Fault"}
          </button>
          <button className="btn"
            onClick={() => { setHistory([]); setLog([]); setStats({ total:0, faults:0 }); tick.current=0; }}
            style={{ background:"#1e293b", color:"#cbd5e1", border:"1px solid #334155" }}>
            🔄 Reset
          </button>
        </div>
      </div>

      {/* Clear Status Banner */}
      <div style={{ 
        background: statusBanner.bg, 
        color: statusBanner.color, 
        padding: "16px 20px", 
        borderRadius: "8px", 
        marginBottom: "30px", 
        fontSize: "16px",
        fontWeight: "600",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: `1px solid ${statusBanner.color}40`,
        boxShadow: `0 4px 12px ${statusBanner.color}15`
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ 
            width: "12px", height: "12px", borderRadius: "50%", 
            background: statusBanner.color, 
            boxShadow: `0 0 10px ${statusBanner.color}`, 
            animation: "pulse 2s infinite" 
          }}/>
          {statusBanner.text}
        </div>
        {lastUpdate && <div style={{ fontSize: "14px", fontWeight: "400", opacity: 0.9 }}>Last Update: {lastUpdate}</div>}
      </div>

      {/* Connection guide banner — shown when no real server */}
      {(mode !== "live") && (
        <div style={{ background:"#0f172a", border:"1px solid rgba(245, 158, 11, 0.3)", borderRadius:"8px", padding:"20px", marginBottom:"30px" }}>
          <div style={{ color:"#fbbf24", fontWeight:"600", fontSize:"16px", marginBottom:"12px" }}>📋 Hardware Connection Guide</div>
          <div style={{ color:"#94a3b8", lineHeight:"1.8", fontSize:"15px" }}>
            <span style={{color:"#e2e8f0"}}>1.</span> Run <code>pip install flask scikit-learn pandas flask-cors</code><br/>
            <span style={{color:"#e2e8f0"}}>2.</span> Run <code>python server.py</code> on your laptop<br/>
            <span style={{color:"#e2e8f0"}}>3.</span> Find your IP Address: <code>ipconfig</code> (Windows) or <code>ifconfig</code> (Mac/Linux)<br/>
            <span style={{color:"#e2e8f0"}}>4.</span> Enter that IP in <code>esp32_sensor.ino</code> as <code>serverURL</code>, then upload code to ESP32<br/>
            <span style={{color:"#e2e8f0"}}>5.</span> The dashboard will automatically update and the banner above will turn Green.
          </div>
        </div>
      )}

      {/* Main System Status and Stats Area */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"20px", marginBottom:"30px" }}>
        
        {/* Anomaly Detection Status Box */}
        <div style={{ 
            display:"flex", alignItems:"center", gap:"16px", padding:"24px", borderRadius:"12px",
            border:`1px solid ${anomaly.isAnomaly ? "rgba(239, 68, 68, 0.4)" : "rgba(16, 185, 129, 0.4)"}`,
            background: anomaly.isAnomaly ? "rgba(239, 68, 68, 0.05)" : "rgba(16, 185, 129, 0.05)",
            boxShadow:`0 4px 20px ${anomaly.isAnomaly ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.05)"}`, 
            transition:"all 0.3s ease" 
          }}>
          <div style={{ 
            width:"18px", height:"18px", borderRadius:"50%", 
            background: anomaly.isAnomaly ? "#ef4444" : "#10b981",
            boxShadow:`0 0 15px ${anomaly.isAnomaly ? "#ef4444" : "#10b981"}`, 
            animation: anomaly.isAnomaly ? "pulse 1s infinite" : "none" 
          }}/>
          <div>
            <div style={{ fontSize:"14px", color:"#64748b", fontWeight:"600", marginBottom:"4px" }}>SYSTEM HEALTH</div>
            <div style={{ fontSize:"22px", fontWeight:"bold", color: anomaly.isAnomaly ? "#ef4444" : "#10b981" }}>
              {anomaly.isAnomaly ? `FAULT DETECTED: ${anomaly.reasons.join(", ")}` : "ALL SYSTEMS NORMAL"}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:"flex", gap:"12px" }}>
          {[
            {label:"TOTAL READINGS", val:stats.total, color:"#3b82f6"},
            {label:"FAULTS DETECTED", val:stats.faults, color:"#ef4444"},
            {label:"FAULT RATE", val:`${faultRate}%`, color: +faultRate > 20 ? "#ef4444" : "#10b981"}
          ].map(s => (
            <div key={s.label} style={{ padding:"20px", background:"#0f172a", border:"1px solid #1e293b", borderRadius:"12px", minWidth:"150px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <div style={{ fontSize:"13px", color:"#64748b", fontWeight:"600", marginBottom:"8px" }}>{s.label}</div>
              <div style={{ fontSize:"28px", fontWeight:"bold", color:s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Gauges */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"20px", marginBottom:"30px" }}>
        {[
          { key:"temp",     label:"TEMPERATURE", unit:"°C",  min:0,   max:80,   color:"#f97316", lo:5,  hi:50  },
          { key:"humidity", label:"HUMIDITY",    unit:"%",   min:0,   max:100,  color:"#3b82f6", lo:15, hi:85  },
        ].map(s => {
          const val = current[s.key];
          const isA = val < s.lo || val > s.hi;
          return (
            <div key={s.key} style={{ background:"#0f172a", border:`1px solid ${isA?"rgba(239, 68, 68, 0.4)":"#1e293b"}`,
              borderRadius:"12px", padding:"30px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:"12px",
              boxShadow: isA?"0 0 24px rgba(239, 68, 68, 0.15)":"none", transition:"all 0.3s ease" }}>
              <Gauge value={val} min={s.min} max={s.max} unit={s.unit} label={s.label} anomaly={isA} color={s.color}/>
              <div style={{ fontSize:"13px", color:"#64748b", fontWeight:"500" }}>Safe Range: {s.lo}–{s.hi} {s.unit}</div>
              {isA && <div style={{ fontSize:"14px", fontWeight:"600", color:"#ef4444", animation:"pulse 1s infinite", marginTop:"8px" }}>⚠️ CRITICAL FAULT</div>}
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"20px", marginBottom:"30px" }}>
        {[
          {key:"temp",     label:"Temperature History (°C)", color:"#f97316", hi:50},
          {key:"humidity", label:"Humidity History (%)",      color:"#3b82f6", hi:85},
        ].map(s => (
          <div key={s.key} style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:"12px", padding:"20px" }}>
            <div style={{ fontSize:"14px", color:"#cbd5e1", fontWeight:"600", marginBottom:"16px" }}>{s.label}</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={history} margin={{top:5,right:5,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="tick" hide/>
                <YAxis tick={{fill:"#64748b",fontSize:12}} axisLine={{stroke: "#1e293b"}} tickLine={false}/>
                <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:"13px",borderRadius:"6px"}} itemStyle={{color:s.color, fontWeight:"600"}}/>
                <ReferenceLine y={s.hi} stroke="rgba(239, 68, 68, 0.5)" strokeDasharray="4 4"/>
                <Line type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.5} dot={false} activeDot={{r:5,fill:s.color,stroke:"#0f172a",strokeWidth:2}} isAnimationActive={false}/>
                <Line type="monotone" dataKey={d => d.anomaly ? d[s.key] : null}
                  stroke="#ef4444" strokeWidth={0} dot={{r:6,fill:"#ef4444",strokeWidth:0}} activeDot={false} isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Log */}
      <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:"12px", padding:"20px" }}>
        <div style={{ fontSize:"14px", color:"#cbd5e1", fontWeight:"600", marginBottom:"16px" }}>Real-time Event Log</div>
        <div style={{ maxHeight:"200px", overflowY:"auto", paddingRight:"8px" }}>
          {log.length === 0
            ? <div style={{color:"#64748b",fontSize:"14px",padding:"10px",textAlign:"center"}}>Waiting for sensor readings…</div>
            : log.map((e,i) => (
              <div key={i} style={{ display:"flex", gap:"16px", padding:"12px 16px", borderRadius:"6px", marginBottom:"8px",
                borderLeft:`4px solid ${e.isAnomaly ? "#ef4444" : "#10b981"}`,
                background: i%2===0 ? "rgba(30, 41, 59, 0.4)" : "transparent", opacity:Math.max(0.4, 1-i*0.08) }}>
                <span style={{color:"#94a3b8",fontSize:"14px",minWidth:"80px"}}>{e.time}</span>
                <span style={{color:e.isAnomaly ? "#ef4444" : "#10b981",fontSize:"14px",minWidth:"90px",fontWeight:"600"}}>
                  {e.isAnomaly ? "⚠️ ANOMALY" : "✓ NORMAL"}
                </span>
                <span style={{color:"#e2e8f0",fontSize:"14px"}}>
                  Temp: {e.temp}°C, Humidity: {e.humidity}%
                </span>
                <span style={{color:"#64748b",fontSize:"13px",marginLeft:"auto"}}>
                  Source: {e.source}
                </span>
              </div>
            ))}
        </div>
      </div>
      
    </div>
  );
}
