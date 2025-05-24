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
const defaultPrompt = `Summarize the following recent PubMed papers on the topic '{topic}'. Use markdown for formatting and include references to the papers by their URLs.\n\nMake sure you include inline references and markdown formatting.\n\nWrite a concise essay that includes recent findings, context, and consequences to the field. Do not just make a list of papers and bullet points; instead, synthesize the information into a unified summary. It is OK to split chapters if some topics are too unrelated.\n\nRemember to include inline citations using this format: "specific statement [authors](url)."\n\nAt the beginning, include a handful of bolded bullet points (with linked references) about the most important info.\n\nAlso include any interesting novel methods if they are interesting`;

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
    // Settings panel logic for slide-down
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
    settingsBtn.onclick = function(e) {
        e.preventDefault();
        loadSettingsToPanel();
        settingsPanel.classList.toggle('open');
        settingsBtn.classList.toggle('open');
    };
    closeSettingsBtn.onclick = function() {
        settingsPanel.classList.remove('open');
        settingsBtn.classList.remove('open');
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

// Simple cache for up to 50 papers (id -> {title, authors, url, abstract})
const paperCache = JSON.parse(localStorage.getItem('paperCache') || '{}');
function updatePaperCache(papers) {
    // Add new papers, keep only the last 50 unique
    for (const p of papers) {
        paperCache[p.id] = p;
    }
    const keys = Object.keys(paperCache);
    if (keys.length > 50) {
        // Remove oldest
        const toRemove = keys.slice(0, keys.length - 50);
        for (const k of toRemove) delete paperCache[k];
    }
    localStorage.setItem('paperCache', JSON.stringify(paperCache));
}
function getCachedPaper(id) {
    return paperCache[id];
}

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
                    // Fetch abstracts sequentially with delay, using cache if available
                    const ids = data.esearchresult.idlist;
                    let fetchedPapers = [];
                    function fetchAbstractSequentially(i) {
                        if (i >= ids.length) {
                            // Sort papers by publication date (most recent first)
                            fetchedPapers.sort((a, b) => {
                                // Compare ISO date strings or fallback to empty string
                                return (b.pubdate || '').localeCompare(a.pubdate || '');
                            });
                            // All done
                            progressBar.style.display = 'block';
                            progressFill.style.width = '100%';
                            progressText.textContent = 'Sending to OpenAI for summarization...';
                            // Render results
                            let html = `<strong>Recent PubMed Papers for \"${query}\":</strong><ul style='list-style-type:none;padding-left:0;'>`;
                            fetchedPapers.forEach((paper, idx) => {
                                html += `<li style='margin-bottom:12px;'>
                                    <a href='#' class='paper-title' data-id='${paper.id}' style='font-weight:bold;text-decoration:underline;color:#1976d2;'>${paper.title}</a>
                                    <span style='color:#888;'> (${paper.authors || 'No authors listed'})</span>
                                    <div class='abstract' id='abstract-${paper.id}' style='display:none; margin-top:6px; font-size:0.98em; color:#444;'></div>
                                    <a href='${paper.url}' target='_blank' style='margin-left:8px;font-size:0.95em;'>[PubMed]</a>
                                </li>`;
                            });
                            html += '</ul>';
                            resultsDiv.innerHTML = html;
                            // Add click listeners for titles to show/hide abstract from memory with animation
                            document.querySelectorAll('.paper-title').forEach(function(titleLink) {
                                titleLink.addEventListener('click', function(e) {
                                    e.preventDefault();
                                    const paperId = this.getAttribute('data-id');
                                    const abstractDiv = document.getElementById('abstract-' + paperId);
                                    if (abstractDiv.style.maxHeight && abstractDiv.style.maxHeight !== '0px') {
                                        // Animate close
                                        abstractDiv.style.maxHeight = '0px';
                                        abstractDiv.style.opacity = '0';
                                        setTimeout(() => {
                                            abstractDiv.style.display = 'none';
                                            abstractDiv.textContent = '';
                                        }, 300);
                                        return;
                                    }
                                    abstractDiv.textContent = abstracts[paperId] || 'No abstract available.';
                                    abstractDiv.style.display = 'block';
                                    abstractDiv.style.opacity = '0';
                                    abstractDiv.style.maxHeight = '0px';
                                    setTimeout(() => {
                                        abstractDiv.style.transition = 'max-height 0.3s cubic-bezier(.4,0,.2,1), opacity 0.25s';
                                        abstractDiv.style.maxHeight = '400px';
                                        abstractDiv.style.opacity = '1';
                                    }, 10);
                                });
                            });
                            // Send to OpenAI for summarization, ask for markdown formatting and references
                            if (!openaiKey || !openaiKey.startsWith('sk-')) {
                                const openaiSummaryDiv = document.getElementById('openaiSummary');
                                openaiSummaryDiv.style.display = 'block';
                                openaiSummaryDiv.innerHTML = '<span style="color:#b71c1c; font-weight:bold;">No valid OpenAI API key provided. Please enter your key in the settings menu to enable summaries.</span>';
                                progressBar.style.display = 'none';
                                return;
                            }
                            if (openaiKey && openaiKey.startsWith('sk-')) {
                                const openaiSummaryDiv = document.getElementById('openaiSummary');
                                openaiSummaryDiv.style.display = 'block';
                                openaiSummaryDiv.innerHTML = '<span class="buffering-spinner"></span> Summarizing with OpenAI...';
                                let prompt = (openaiPrompt || defaultPrompt).replace('{topic}', query);
                                console.log('[OpenAI] About to send prompt:', prompt);
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
                                .then(resp => {
                                    console.log('[OpenAI] Waiting for response...');
                                    return resp.json();
                                })
                                .then(data => {
                                    progressBar.style.display = 'none';
                                    console.log('[OpenAI] Response received:', data);
                                    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
                                        openaiSummaryDiv.innerHTML = marked.parse(data.choices[0].message.content);
                                    } else {
                                        openaiSummaryDiv.textContent = 'No summary returned from OpenAI.';
                                    }
                                })
                                .catch((err) => {
                                    progressBar.style.display = 'none';
                                    console.error('[OpenAI] Error fetching summary:', err);
                                    openaiSummaryDiv.textContent = 'Error fetching summary from OpenAI.';
                                });
                            } else {
                                progressBar.style.display = 'none';
                                console.warn('[OpenAI] No OpenAI API key provided. Skipping OpenAI summary.');
                                document.getElementById('openaiSummary').style.display = 'none';
                            }
                            updatePaperCache(fetchedPapers);
                            return;
                        }
                        // Progress update
                        const percent = Math.round((i / ids.length) * 100);
                        progressFill.style.width = percent + '%';
                        progressText.textContent = `Fetching abstracts: ${i+1} / ${ids.length}`;
                        progressBar.style.display = 'block';
                        // Use CORS proxy for efetch
                        const corsProxy = 'https://corsproxy.io/?';
                        const cached = getCachedPaper(ids[i]);
                        if (cached) {
                            abstracts[ids[i]] = cached.abstract;
                            fetchedPapers.push(cached);
                            setTimeout(() => fetchAbstractSequentially(i + 1), 10);
                            return;
                        }
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
                                // Extract publication date from summary data if available
                                let pubdate = '';
                                if (papers[ids[i]]) {
                                    pubdate = papers[ids[i]].sortpubdate || papers[ids[i]].epubdate || papers[ids[i]].pubdate || '';
                                }
                                if (!pubdate) {
                                    // Try to extract from XML if not in summary
                                    const dateNode = xmlDoc.querySelector('PubDate');
                                    if (dateNode) pubdate = dateNode.textContent.trim();
                                }
                                const paperObj = {
                                    id: ids[i],
                                    title: papers[ids[i]].title,
                                    authors: authors.join(', '),
                                    url: `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
                                    abstract,
                                    pubdate
                                };
                                abstracts[ids[i]] = abstract;
                                fetchedPapers.push(paperObj);
                            })
                            .catch(() => {
                                let pubdate = '';
                                if (papers[ids[i]]) {
                                    pubdate = papers[ids[i]].sortpubdate || papers[ids[i]].epubdate || papers[ids[i]].pubdate || '';
                                }
                                abstracts[ids[i]] = '';
                                fetchedPapers.push({
                                    id: ids[i],
                                    title: papers[ids[i]].title,
                                    authors: '',
                                    url: `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
                                    abstract: '',
                                    pubdate
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
