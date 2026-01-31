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

// Test IP with actual connection test
async function testIP(ip, port = 443, timeout = 3000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const img = new Image();
        let timer;
        let completed = false;

        const cleanup = () => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            img.onload = null;
            img.onerror = null;
        };

        img.onload = () => {
            cleanup();
            const ping = Date.now() - start;
            resolve(ping);
        };

        img.onerror = () => {
            cleanup();
            const ping = Date.now() - start;
            // Even on error, if response was fast, IP is reachable
            if (ping < timeout) {
                resolve(ping);
            } else {
                resolve(null);
            }
        };

        timer = setTimeout(() => {
            cleanup();
            resolve(null);
        }, timeout);

        // Try to load a small resource from Cloudflare CDN on this IP
        // Using cache-busting to avoid cached responses
        img.src = `https://${ip}/cdn-cgi/trace?t=${Date.now()}`;
    });
}

// Alternative WebSocket test method
async function testIPWebSocket(ip, timeout = 3000) {
    return new Promise((resolve) => {
        const start = Date.now();
        let completed = false;

        try {
            const ws = new WebSocket(`wss://${ip}/`);
            
            const timer = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    ws.close();
                    resolve(null);
                }
            }, timeout);

            ws.onopen = () => {
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    const ping = Date.now() - start;
                    ws.close();
                    resolve(ping);
                }
            };

            ws.onerror = () => {
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    const ping = Date.now() - start;
                    // Fast error can mean server responded quickly
                    if (ping < 500) {
                        resolve(ping);
                    } else {
                        resolve(null);
                    }
                }
            };
        } catch (error) {
            resolve(null);
        }
    });
}

// Combined test using both methods
async function testIPCombined(ip, maxPing) {
    const pings = [];
    
    for (let i = 0; i < 3; i++) {
        // Try image method first
        let ping = await testIP(ip, 443, 3000);
        
        // If image fails, try WebSocket
        if (ping === null) {
            ping = await testIPWebSocket(ip, 3000);
        }
        
        if (ping !== null && ping < maxPing) {
            pings.push(ping);
        }
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 200));
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
    document.getElementById('testedCount').textContent = '0';
    document.getElementById('progressBar').style.width = '0%';
    
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
            alert(`رنج نامعتبر: ${range}`);
            stopScan();
            return;
        }
    }
    
    if (allIPs.length === 0) {
        alert('هیچ IP ای برای اسکن پیدا نشد!');
        stopScan();
        return;
    }
    
    console.log(`Starting scan of ${allIPs.length} IPs...`);
    
    // Update UI
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('exportBtn').disabled = true;
    document.getElementById('status').textContent = 'در حال اسکن...';
    
    // Scan IPs with concurrency control
    const batchSize = 5; // Reduced for better stability
    let tested = 0;
    
    for (let i = 0; i < allIPs.length && scanning; i += batchSize) {
        const batch = allIPs.slice(i, Math.min(i + batchSize, allIPs.length));
        
        const promises = batch.map(async (ip) => {
            const pings = await testIPCombined(ip, maxPing);
            
            tested++;
            updateStats(tested, allIPs.length);
            
            if (pings.length > 0 && scanning) {
                addResult(ip, pings);
                console.log(`Found working IP: ${ip} (${pings.join(', ')}ms)`);
            }
        });
        
        await Promise.all(promises);
    }
    
    // Finish
    console.log('Scan completed');
    stopScan();
}

function stopScan() {
    scanning = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    
    if (results.length === 0) {
        document.getElementById('status').textContent = 'تمام شد - هیچ IP ای پیدا نشد';
        document.getElementById('resultsContainer').innerHTML = '<p class="empty-state">هیچ IP مناسبی پیدا نشد</p>';
    } else {
        document.getElementById('status').textContent = `تمام شد - ${results.length} IP پیدا شد`;
    }
}

function exportResults() {
    if (results.length === 0) return;
    
    // Sort by average ping
    results.sort((a, b) => parseFloat(a.avgPing) - parseFloat(b.avgPing));
    
    // Create CSV
    let csv = 'IP Address,Ping 1 (ms),Ping 2 (ms),Ping 3 (ms),Average Ping (ms)
';
    
    results.forEach(result => {
        const pingsStr = result.pings.join(',');
        const missingPings = 3 - result.pings.length;
        const emptyFields = ','.repeat(missingPings);
        csv += `${result.ip},${pingsStr}${emptyFields},${result.avgPing}
`;
    });
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cloudflare-ips-${Date.now()}.csv`;
    link.click();
}
