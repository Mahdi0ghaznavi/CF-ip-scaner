// Default Cloudflare IP ranges
const DEFAULT_RANGES = [
    '162.159.192.0/24',
    '162.159.193.0/24',
    '162.159.195.0/24',
    '162.159.204.0/24',
    '188.114.96.0/24',
    '188.114.97.0/24',
    '188.114.98.0/24',
    '188.114.99.0/24'
];

let scanning = false;
let results = [];
let testedCount = 0;
let successCount = 0;

// Parse CIDR to IP array
function parseCIDR(cidr) {
    const [base, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const baseNum = ipToNumber(base);
    const start = (baseNum & mask) >>> 0;
    const end = (start | ~mask) >>> 0;
    
    const ips = [];
    for (let i = start; i <= end; i++) {
        ips.push(numberToIp(i));
    }
    return ips;
}

function ipToNumber(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

function numberToIp(num) {
    return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff
    ].join('.');
}

// Test IP with ping simulation
async function testIP(ip, sni, maxPing) {
    const pings = [];
    
    for (let i = 0; i < 3; i++) {
        try {
            const start = Date.now();
            
            // Use fetch with timeout to simulate ping
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            await fetch(`https://${ip}`, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: controller.signal,
                headers: {
                    'Host': sni
                }
            }).catch(() => {});
            
            clearTimeout(timeout);
            const ping = Date.now() - start;
            
            if (ping < maxPing) {
                pings.push(ping);
            }
        } catch (error) {
            // Timeout or error
            continue;
        }
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return pings;
}

function addResult(ip, pings) {
    const avgPing = (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(0);
    
    results.push({ ip, pings, avgPing });
    
    const resultsContainer = document.getElementById('resultsContainer');
    
    // Remove empty state
    if (resultsContainer.querySelector('.empty-state')) {
        resultsContainer.innerHTML = '';
    }
    
    const resultDiv = document.createElement('div');
    resultDiv.className = 'result-item';
    
    const ipSpan = document.createElement('div');
    ipSpan.className = 'result-ip';
    ipSpan.textContent = ip;
    
    const pingsDiv = document.createElement('div');
    pingsDiv.className = 'result-pings';
    
    pings.forEach(ping => {
        const badge = document.createElement('span');
        badge.className = 'ping-badge';
        if (ping > 200) badge.classList.add('warning');
        if (ping > 400) badge.classList.add('error');
        badge.textContent = `${ping}ms`;
        pingsDiv.appendChild(badge);
    });
    
    const avgBadge = document.createElement('span');
    avgBadge.className = 'ping-badge';
    avgBadge.style.background = '#667eea';
    avgBadge.textContent = `میانگین: ${avgPing}ms`;
    pingsDiv.appendChild(avgBadge);
    
    resultDiv.appendChild(ipSpan);
    resultDiv.appendChild(pingsDiv);
    
    resultsContainer.insertBefore(resultDiv, resultsContainer.firstChild);
    
    // Update success count
    successCount++;
    document.getElementById('successCount').textContent = successCount;
    
    // Enable export button
    document.getElementById('exportBtn').disabled = false;
}

function updateStats(tested, total) {
    testedCount = tested;
    document.getElementById('testedCount').textContent = `${tested} / ${total}`;
    
    const progress = (tested / total) * 100;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

async function startScan() {
    // Reset
    scanning = true;
    results = [];
    testedCount = 0;
    successCount = 0;
    document.getElementById('resultsContainer').innerHTML = '<p class="empty-state">در حال اسکن...</p>';
    document.getElementById('successCount').textContent = '0';
    
    // Get configuration
    const sni = document.getElementById('sni').value || 'speed.cloudflare.com';
    const maxPing = parseInt(document.getElementById('maxPing').value) || 300;
    const customRangeInput = document.getElementById('customRange').value.trim();
    
    // Determine IP ranges
    let ranges = DEFAULT_RANGES;
    if (customRangeInput) {
        ranges = customRangeInput.split('
').map(r => r.trim()).filter(r => r);
    }
    
    // Parse all IPs
    const allIPs = [];
    for (const range of ranges) {
        try {
            const ips = parseCIDR(range);
            allIPs.push(...ips);
        } catch (error) {
            console.error(`Invalid range: ${range}`, error);
        }
    }
    
    // Update UI
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('exportBtn').disabled = true;
    document.getElementById('status').textContent = 'در حال اسکن...';
    
    // Scan IPs
    const batchSize = 10;
    for (let i = 0; i < allIPs.length && scanning; i += batchSize) {
        const batch = allIPs.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (ip) => {
            const pings = await testIP(ip, sni, maxPing);
            
            if (pings.length > 0 && scanning) {
                addResult(ip, pings);
            }
            
            updateStats(i + batch.indexOf(ip) + 1, allIPs.length);
        }));
    }
    
    // Finish
    stopScan();
}

function stopScan() {
    scanning = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('status').textContent = 'متوقف شد';
    
    if (results.length === 0) {
        document.getElementById('resultsContainer').innerHTML = '<p class="empty-state">هیچ IP مناسبی پیدا نشد</p>';
    }
}

function exportResults() {
    if (results.length === 0) return;
    
    // Create CSV
    let csv = 'IP Address,Ping 1 (ms),Ping 2 (ms),Ping 3 (ms),Average Ping (ms)
';
    
    results.forEach(result => {
        const pingsStr = result.pings.join(',');
        csv += `${result.ip},${pingsStr},${result.avgPing}
`;
    });
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cloudflare-ips-${Date.now()}.csv`;
    link.click();
}