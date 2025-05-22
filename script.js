// Remember and restore OpenAI API key
window.addEventListener('DOMContentLoaded', function() {
    const openaiKeyInput = document.getElementById('openaiKeyInput');
    if (openaiKeyInput) {
        const savedKey = localStorage.getItem('openaiApiKey');
        if (savedKey) openaiKeyInput.value = savedKey;
        openaiKeyInput.addEventListener('input', function() {
            if (openaiKeyInput.value.startsWith('sk-')) {
                localStorage.setItem('openaiApiKey', openaiKeyInput.value);
            }
        });
    }
});

// Settings panel logic and persistence
const defaultPrompt = "Summarize the following recent PubMed papers on the topic '{topic}'. Use markdown for formatting and include references to the papers by their URLs.";

function getSettings() {
    return {
        openaiKey: localStorage.getItem('openaiApiKey') || '',
        retmax: localStorage.getItem('retmax') || '5',
        prompt: localStorage.getItem('openaiPrompt') || defaultPrompt
    };
}
function setSettings({openaiKey, retmax, prompt}) {
    if (openaiKey !== undefined) localStorage.setItem('openaiApiKey', openaiKey);
    if (retmax !== undefined) localStorage.setItem('retmax', retmax);
    if (prompt !== undefined) localStorage.setItem('openaiPrompt', prompt);
}
function resetSettings() {
    localStorage.removeItem('openaiApiKey');
    localStorage.removeItem('retmax');
    localStorage.removeItem('openaiPrompt');
}

window.addEventListener('DOMContentLoaded', function() {
    // Hamburger menu logic
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    const settingsOpenaiKey = document.getElementById('settingsOpenaiKey');
    const settingsRetmax = document.getElementById('settingsRetmax');
    const settingsPrompt = document.getElementById('settingsPrompt');

    function loadSettingsToPanel() {
        const s = getSettings();
        settingsOpenaiKey.value = s.openaiKey;
        settingsRetmax.value = s.retmax;
        settingsPrompt.value = s.prompt;
    }
    settingsBtn.onclick = function() {
        loadSettingsToPanel();
        settingsPanel.style.display = 'block';
    };
    closeSettingsBtn.onclick = function() {
        settingsPanel.style.display = 'none';
    };
    resetSettingsBtn.onclick = function() {
        resetSettings();
        loadSettingsToPanel();
    };
    settingsOpenaiKey.oninput = function() {
        setSettings({openaiKey: settingsOpenaiKey.value});
    };
    settingsRetmax.oninput = function() {
        setSettings({retmax: settingsRetmax.value});
    };
    settingsPrompt.oninput = function() {
        setSettings({prompt: settingsPrompt.value});
    };

    // Set retmax and openaiKey in form on load
    const s = getSettings();
    document.getElementById('searchInput').focus();
});

document.getElementById('searchForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    const resultsDiv = document.getElementById('results');
    // Get settings from localStorage
    const openaiKey = localStorage.getItem('openaiApiKey') || '';
    const retmax = parseInt(localStorage.getItem('retmax') || '5', 10);
    const openaiPrompt = localStorage.getItem('openaiPrompt') || defaultPrompt;
    if (openaiKey && openaiKey.startsWith('sk-')) {
        localStorage.setItem('openaiApiKey', openaiKey);
    }
    if (!query) {
        resultsDiv.textContent = 'Please enter a topic.';
        return;
    }
    resultsDiv.textContent = 'Searching for "' + query + '"...';
    document.getElementById('openaiSummary').style.display = 'none';
    // Remove previous printout if any
    let printoutDiv = document.getElementById('openaiPrintout');
    if (printoutDiv) printoutDiv.remove();

    // Fetch recent papers from NCBI PubMed
    fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=pub+date&retmode=json`)
        .then(response => response.json())
        .then(data => {
            if (!data.esearchresult || !data.esearchresult.idlist || data.esearchresult.idlist.length === 0) {
                resultsDiv.textContent = 'No recent papers found for this topic on PubMed.';
                return;
            }
            // Fetch summaries for the found IDs
            const ids = data.esearchresult.idlist.join(',');
            fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids}&retmode=json`)
                .then(response => response.json())
                .then(summaryData => {
                    const papers = summaryData.result;
                    // Store abstracts in memory
                    const abstracts = {};
                    // Printout for user
                    let printout = '';
                    // Progress bar setup
                    let progressBar = document.getElementById('abstractProgressBar');
                    if (!progressBar) {
                        progressBar = document.createElement('div');
                        progressBar.id = 'abstractProgressBar';
                        progressBar.style = 'margin:24px 0 12px 0; height:28px; background:#e3f2fd; border-radius:6px; overflow:hidden; position:relative;';
                        progressBar.innerHTML = '<div id="abstractProgressFill" style="height:100%; width:0; background:#1976d2; transition:width 0.3s;"></div>' +
                            '<span id="abstractProgressText" style="position:absolute; left:0; right:0; top:0; bottom:0; display:flex; align-items:center; justify-content:center; color:#1a237e; font-weight:bold;"></span>';
                        document.querySelector('.card').insertBefore(progressBar, resultsDiv);
                    }
                    const progressFill = document.getElementById('abstractProgressFill');
                    const progressText = document.getElementById('abstractProgressText');
                    // Fetch abstracts sequentially with delay
                    const ids = data.esearchresult.idlist;
                    let fetchedPapers = [];
                    function fetchAbstractSequentially(i) {
                        if (i >= ids.length) {
                            // All done
                            progressBar.style.display = 'block';
                            progressFill.style.width = '100%';
                            progressText.textContent = 'Sending to OpenAI for summarization...';
                            // Render results and printout
                            let html = `<strong>Recent PubMed Papers for \"${query}\":</strong><ul style='list-style-type:none;padding-left:0;'>`;
                            let printout = '';
                            fetchedPapers.forEach((paper, idx) => {
                                html += `<li style='margin-bottom:12px;'>
                                    <a href='#' class='paper-title' data-id='${paper.id}' style='font-weight:bold;text-decoration:underline;color:#1976d2;'>${paper.title}</a>
                                    <span style='color:#888;'> (${paper.authors || 'No authors listed'})</span>
                                    <div class='abstract' id='abstract-${paper.id}' style='display:none; margin-top:6px; font-size:0.98em; color:#444;'></div>
                                    <a href='${paper.url}' target='_blank' style='margin-left:8px;font-size:0.95em;'>[PubMed]</a>
                                </li>`;
                                printout += `# ${paper.title}\n`;
                                printout += `## ${paper.authors || 'No authors listed'}\n`;
                                printout += `### ${paper.url}\n\n`;
                                printout += `${paper.abstract || 'No abstract available.'}\n---\n`;
                            });
                            html += '</ul>';
                            resultsDiv.innerHTML = html;
                            // Printout below results
                            let printoutDiv = document.getElementById('openaiPrintout');
                            if (!printoutDiv) {
                                printoutDiv = document.createElement('div');
                                printoutDiv.id = 'openaiPrintout';
                                printoutDiv.style = 'margin-top:32px; background:#f8f8f8; border-radius:6px; padding:18px; font-family:monospace; font-size:1em; color:#222; white-space:pre-wrap;';
                                document.querySelector('.card').appendChild(printoutDiv);
                            }
                            printoutDiv.textContent = printout;
                            // Add click listeners for titles to show/hide abstract from memory
                            document.querySelectorAll('.paper-title').forEach(function(titleLink) {
                                titleLink.addEventListener('click', function(e) {
                                    e.preventDefault();
                                    const paperId = this.getAttribute('data-id');
                                    const abstractDiv = document.getElementById('abstract-' + paperId);
                                    if (abstractDiv.style.display === 'block') {
                                        abstractDiv.style.display = 'none';
                                        abstractDiv.textContent = '';
                                        return;
                                    }
                                    abstractDiv.textContent = abstracts[paperId] || 'No abstract available.';
                                    abstractDiv.style.display = 'block';
                                });
                            });
                            // Send to OpenAI for summarization, ask for markdown formatting and references
                            if (openaiKey && openaiKey.startsWith('sk-')) {
                                const openaiSummaryDiv = document.getElementById('openaiSummary');
                                openaiSummaryDiv.style.display = 'block';
                                openaiSummaryDiv.innerHTML = '<span class="buffering-spinner"></span> Summarizing with OpenAI...';
                                let prompt = (openaiPrompt || defaultPrompt).replace('{topic}', query) + '\n\n' + printout;
                                fetch('https://api.openai.com/v1/chat/completions', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': 'Bearer ' + openaiKey
                                    },
                                    body: JSON.stringify({
                                        model: 'gpt-3.5-turbo',
                                        messages: [{role: 'user', content: prompt}],
                                        max_tokens: 800,
                                        temperature: 0.5
                                    })
                                })
                                .then(resp => resp.json())
                                .then(data => {
                                    progressBar.style.display = 'none';
                                    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
                                        openaiSummaryDiv.innerHTML = marked.parse(data.choices[0].message.content);
                                    } else {
                                        openaiSummaryDiv.textContent = 'No summary returned from OpenAI.';
                                    }
                                })
                                .catch(() => {
                                    progressBar.style.display = 'none';
                                    openaiSummaryDiv.textContent = 'Error fetching summary from OpenAI.';
                                });
                            } else {
                                progressBar.style.display = 'none';
                                document.getElementById('openaiSummary').style.display = 'none';
                            }
                            return;
                        }
                        // Progress update
                        const percent = Math.round((i / ids.length) * 100);
                        progressFill.style.width = percent + '%';
                        progressText.textContent = `Fetching abstracts: ${i+1} / ${ids.length}`;
                        progressBar.style.display = 'block';
                        // Use CORS proxy for efetch
                        const corsProxy = 'https://corsproxy.io/?';
                        fetch(`${corsProxy}https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids[i]}&retmode=xml`)
                            .then(resp => resp.text())
                            .then(xmlText => {
                                const parser = new window.DOMParser();
                                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                                const abstractNode = xmlDoc.querySelector('Abstract > AbstractText');
                                const authorNodes = xmlDoc.querySelectorAll('AuthorList > Author');
                                let authors = [];
                                authorNodes.forEach(a => {
                                    let last = a.querySelector('LastName') ? a.querySelector('LastName').textContent : '';
                                    let fore = a.querySelector('ForeName') ? a.querySelector('ForeName').textContent : '';
                                    if (last || fore) authors.push(`${fore} ${last}`.trim());
                                });
                                const abstract = abstractNode ? abstractNode.textContent : '';
                                abstracts[ids[i]] = abstract;
                                fetchedPapers.push({
                                    id: ids[i],
                                    title: papers[ids[i]].title,
                                    authors: authors.join(', '),
                                    url: `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
                                    abstract
                                });
                            })
                            .catch(() => {
                                abstracts[ids[i]] = '';
                                fetchedPapers.push({
                                    id: ids[i],
                                    title: papers[ids[i]].title,
                                    authors: '',
                                    url: `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
                                    abstract: ''
                                });
                            })
                            .finally(() => {
                                setTimeout(() => fetchAbstractSequentially(i + 1), 500); // 2 per second
                            });
                    }
                    fetchAbstractSequentially(0);
                })
                .catch(() => {
                    resultsDiv.textContent = 'Error fetching paper summaries from NCBI PubMed.';
                });
        })
        .catch(() => {
            resultsDiv.textContent = 'Error fetching papers from NCBI PubMed.';
        });
});
