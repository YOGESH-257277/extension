// Global variables to store extracted data
let extractedData = {
  emails: [],
  phones: [],
  social: [],
  pagesScanned: 0
};

// Default options
const defaultOptions = {
  extractEmails: true,
  extractPhones: true,
  extractSocial: true,
  maxPages: 5,
  followLinks: true,
  maxDepth: 1,
  domainFilter: '',
  excludeDomainFilter: '',
  removeDuplicates: true
};

let options = {...defaultOptions};
let isExtracting = false;

// Initialize the extension
document.addEventListener('DOMContentLoaded', () => {
  // Load saved data and options
  loadDataAndOptions();
  
  // Set up tab navigation
  setupTabs();
  
  // Set up event listeners
  setupEventListeners();
  
  // Update statistics display
  updateStats();
});

// Load saved data and options from storage
function loadDataAndOptions() {
  chrome.storage.local.get(['extractedData', 'options'], (result) => {
    if (result.extractedData) {
      extractedData = result.extractedData;
    }
    
    if (result.options) {
      options = {...defaultOptions, ...result.options};
    }
    
    // Update UI with loaded options
    document.getElementById('extractEmails').checked = options.extractEmails;
    document.getElementById('extractPhones').checked = options.extractPhones;
    document.getElementById('extractSocial').checked = options.extractSocial;
    document.getElementById('maxPages').value = options.maxPages;
    document.getElementById('followLinks').checked = options.followLinks;
    document.getElementById('maxDepth').value = options.maxDepth;
    document.getElementById('domainFilter').value = options.domainFilter;
    document.getElementById('excludeDomainFilter').value = options.excludeDomainFilter;
    document.getElementById('removeDuplicates').checked = options.removeDuplicates;
    
    // Update results and stats
    updateStats();
    updateResultsList();
  });
}

// Set up tab navigation
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      
      // Update active tab button
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Show selected tab content
      tabContents.forEach(content => {
        if (content.id === tabName) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      
      // If switching to results tab, update the list
      if (tabName === 'results') {
        updateResultsList();
      }
    });
  });
}

// Set up event listeners
function setupEventListeners() {
  // Extract from current page button
  document.getElementById('extractBtn').addEventListener('click', () => {
    extractFromCurrentPage();
  });
  
  // Extract from search results button
  document.getElementById('extractSearchBtn').addEventListener('click', () => {
    extractFromSearchResults();
  });
  
  // Export button
  document.getElementById('exportBtn').addEventListener('click', () => {
    exportToCSV();
  });
  
  // Clear button
  document.getElementById('clearBtn').addEventListener('click', () => {
    clearData();
  });
  
  // Options changes
  const optionElements = [
    'extractEmails', 'extractPhones', 'extractSocial', 
    'maxPages', 'followLinks', 'maxDepth',
    'domainFilter', 'excludeDomainFilter', 'removeDuplicates'
  ];
  
  optionElements.forEach(id => {
    const element = document.getElementById(id);
    element.addEventListener('change', () => {
      if (element.type === 'checkbox') {
        options[id] = element.checked;
      } else {
        options[id] = element.value;
      }
      saveOptions();
    });
  });
  
  // Results type select
  document.getElementById('resultTypeSelect').addEventListener('change', () => {
    updateResultsList();
  });
  
  // Results search filter
  document.getElementById('searchResults').addEventListener('input', () => {
    updateResultsList();
  });
}

// Extract data from current page
async function extractFromCurrentPage() {
  try {
    showStatus('Extracting data from current page...', 'info');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showStatus('No active tab found.', 'error');
      return;
    }
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractDataFromPage,
      args: [options]
    });
    
    if (results && results[0] && results[0].result) {
      processExtractedData(results[0].result, 1);
      showStatus('Extraction completed!', 'success');
    }
  } catch (error) {
    console.error('Extraction error:', error);
    showStatus('Error during extraction: ' + error.message, 'error');
  }
}

// Extract from search results (multiple pages)
async function extractFromSearchResults() {
  if (isExtracting) {
    showStatus('Extraction already in progress...', 'info');
    return;
  }
  
  try {
    isExtracting = true;
    showProgressBar(true, 0);
    showStatus('Starting multi-page extraction...', 'info');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showStatus('No active tab found.', 'error');
      isExtracting = false;
      showProgressBar(false);
      return;
    }
    
    // Send message to background script to start extraction
    chrome.runtime.sendMessage({
      action: 'startMultiPageExtraction',
      options: options,
      startUrl: tab.url
    }, (response) => {
      if (response && response.success) {
        // Background script will handle the extraction
        showStatus('Multi-page extraction started in background', 'info');
      } else {
        showStatus('Failed to start extraction: ' + (response?.error || 'Unknown error'), 'error');
        isExtracting = false;
        showProgressBar(false);
      }
    });
  } catch (error) {
    console.error('Multi-page extraction error:', error);
    showStatus('Error during extraction: ' + error.message, 'error');
    isExtracting = false;
    showProgressBar(false);
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractionProgress') {
    updateProgress(message.current, message.total);
  } else if (message.action === 'extractionResult') {
    processExtractedData(message.data, message.pagesScanned);
    showStatus(`Extracted data from ${message.pagesScanned} pages`, 'success');
  } else if (message.action === 'extractionComplete') {
    isExtracting = false;
    showProgressBar(false);
    showStatus('Multi-page extraction completed!', 'success');
  } else if (message.action === 'extractionError') {
    isExtracting = false;
    showProgressBar(false);
    showStatus('Extraction error: ' + message.error, 'error');
  }
  
  sendResponse({ received: true });
  return true;
});

// Process extracted data
function processExtractedData(data, pagesScanned) {
  // Merge new data with existing data
  if (data.emails && options.extractEmails) {
    extractedData.emails = mergeArrays(extractedData.emails, data.emails, options.removeDuplicates);
  }
  
  if (data.phones && options.extractPhones) {
    extractedData.phones = mergeArrays(extractedData.phones, data.phones, options.removeDuplicates);
  }
  
  if (data.social && options.extractSocial) {
    extractedData.social = mergeArrays(extractedData.social, data.social, options.removeDuplicates);
  }
  
  extractedData.pagesScanned += pagesScanned;
  
  // Save to storage and update UI
  saveData();
  updateStats();
  updateResultsList();
  
  // Enable export button if we have data
  document.getElementById('exportBtn').disabled = !(
    extractedData.emails.length > 0 || 
    extractedData.phones.length > 0 || 
    extractedData.social.length > 0
  );
}

// Helper function to merge arrays
function mergeArrays(existing, newData, removeDuplicates) {
  if (removeDuplicates) {
    return [...new Set([...existing, ...newData])];
  } else {
    return [...existing, ...newData];
  }
}

// Update extraction progress
function updateProgress(current, total) {
  const percentage = Math.round((current / total) * 100);
  const progressBar = document.getElementById('progressBar');
  progressBar.style.width = `${percentage}%`;
  progressBar.textContent = `${percentage}%`;
}

// Show/hide progress bar
function showProgressBar(show, initialValue = 0) {
  const container = document.getElementById('progressContainer');
  const bar = document.getElementById('progressBar');
  
  if (show) {
    container.style.display = 'block';
    bar.style.width = `${initialValue}%`;
    bar.textContent = `${initialValue}%`;
  } else {
    container.style.display = 'none';
  }
}

// Export data to CSV
function exportToCSV() {
  try {
    // Create CSV content
    let csvContent = '';
    
    // Add emails
    if (extractedData.emails.length > 0) {
      csvContent += 'Email Addresses\n';
      extractedData.emails.forEach(email => {
        csvContent += `${email}\n`;
      });
      csvContent += '\n';
    }
    
    // Add phone numbers
    if (extractedData.phones.length > 0) {
      csvContent += 'Phone Numbers\n';
      extractedData.phones.forEach(phone => {
        csvContent += `${phone}\n`;
      });
      csvContent += '\n';
    }
    
    // Add social profiles
    if (extractedData.social.length > 0) {
      csvContent += 'Social Media Profiles\n';
      extractedData.social.forEach(profile => {
        csvContent += `${profile}\n`;
      });
    }
    
    // Create a blob and download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `extracted_contacts_${timestamp}.csv`;
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      showStatus('Data exported to CSV!', 'success');
    });
  } catch (error) {
    console.error('Export error:', error);
    showStatus('Error during export: ' + error.message, 'error');
  }
}

// Clear all extracted data
function clearData() {
  extractedData = {
    emails: [],
    phones: [],
    social: [],
    pagesScanned: 0
  };
  
  saveData();
  updateStats();
  updateResultsList();
  document.getElementById('exportBtn').disabled = true;
  showStatus('All data cleared!', 'info');
}

// Save data to storage
function saveData() {
  chrome.storage.local.set({ extractedData: extractedData });
}

// Save options to storage
function saveOptions() {
  chrome.storage.local.set({ options: options });
}

// Update statistics display
function updateStats() {
  document.getElementById('emailCount').textContent = extractedData.emails.length;
  document.getElementById('phoneCount').textContent = extractedData.phones.length;
  document.getElementById('socialCount').textContent = extractedData.social.length;
  document.getElementById('pagesCount').textContent = extractedData.pagesScanned;
}

// Update results list based on selected type
function updateResultsList() {
  const resultType = document.getElementById('resultTypeSelect').value;
  const searchTerm = document.getElementById('searchResults').value.toLowerCase();
  const resultsContainer = document.getElementById('resultsList');
  
  let dataToShow = extractedData[resultType] || [];
  
  // Apply search filter if provided
  if (searchTerm) {
    dataToShow = dataToShow.filter(item => 
      item.toLowerCase().includes(searchTerm)
    );
  }
  
  // Create HTML for results
  let html = '<table>';
  html += `<tr><th>${capitalizeFirstLetter(resultType)}</th></tr>`;
  
  if (dataToShow.length === 0) {
    html += `<tr><td>No ${resultType} found</td></tr>`;
  } else {
    dataToShow.forEach(item => {
      html += `<tr><td>${item}</td></tr>`;
    });
  }
  
  html += '</table>';
  resultsContainer.innerHTML = html;
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Show status message
function showStatus(message, type = 'info') {
  const statusElem = document.getElementById('status');
  statusElem.textContent = message;
  statusElem.className = '';
  statusElem.classList.add(`status-${type}`);
  statusElem.style.display = 'block';
  
  // Hide after 5 seconds for success and info messages
  if (type !== 'error') {
    setTimeout(() => {
      statusElem.style.display = 'none';
    }, 5000);
  }
}

// Function to be injected into the page
function extractDataFromPage(options) {
  // Data objects to store extracted information
  const extractedData = {
    emails: [],
    phones: [],
    social: []
  };
  
  // Regular expressions for extraction
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const socialRegexPatterns = {
    linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[a-zA-Z0-9_-]+/g,
    twitter: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/g,
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/(?:profile\.php\?id=\d+|[a-zA-Z0-9.]+)/g,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_\.]+/g
  };
  
  // Get the entire page content
  const pageContent = document.body.innerText;
  const pageHTML = document.documentElement.outerHTML;
  
  // Extract emails if enabled
  if (options.extractEmails) {
    let matches = pageContent.match(emailRegex) || [];
    
    // Apply domain filters if provided
    if (options.domainFilter) {
      const includeDomains = options.domainFilter.split(',').map(d => d.trim());
      matches = matches.filter(email => {
        const domain = email.split('@')[1];
        return includeDomains.some(d => domain.includes(d));
      });
    }
    
    if (options.excludeDomainFilter) {
      const excludeDomains = options.excludeDomainFilter.split(',').map(d => d.trim());
      matches = matches.filter(email => {
        const domain = email.split('@')[1];
        return !excludeDomains.some(d => domain.includes(d));
      });
    }
    
    extractedData.emails = options.removeDuplicates ? [...new Set(matches)] : matches;
  }
  
  // Extract phone numbers if enabled
  if (options.extractPhones) {
    const matches = pageContent.match(phoneRegex) || [];
    extractedData.phones = options.removeDuplicates ? [...new Set(matches)] : matches;
  }
  
  // Extract social media profiles if enabled
  if (options.extractSocial) {
    let socialProfiles = [];
    
    // Search for social media links in the HTML
    for (const [platform, regex] of Object.entries(socialRegexPatterns)) {
      const matches = pageHTML.match(regex) || [];
      socialProfiles = [...socialProfiles, ...matches];
    }
    
    extractedData.social = options.removeDuplicates ? [...new Set(socialProfiles)] : socialProfiles;
  }
  
  return extractedData;
}