// Background script for advanced email extractor

// Global state for multi-page extraction
let multiPageState = {
  isRunning: false,
  visitedUrls: new Set(),
  pendingUrls: [],
  pageCounter: 0,
  maxPages: 5,
  depth: 0,
  maxDepth: 1,
  options: null,
  results: {
    emails: [],
    phones: [],
    social: []
  }
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMultiPageExtraction') {
    // Start multi-page extraction process
    if (multiPageState.isRunning) {
      sendResponse({ success: false, error: 'Extraction already in progress' });
      return true;
    }
    
    startMultiPageExtraction(request.startUrl, request.options);
    sendResponse({ success: true });
  }
  
  return true; // Keep the message channel open for async response
});

// Start the multi-page extraction process
async function startMultiPageExtraction(startUrl, options) {
  // Reset state
  multiPageState = {
    isRunning: true,
    visitedUrls: new Set(),
    pendingUrls: [startUrl],
    pageCounter: 0,
    maxPages: options.maxPages,
    depth: 0,
    maxDepth: options.maxDepth,
    options: options,
    results: {
      emails: [],
      phones: [],
      social: []
    }
  };
  
  try {
    // Process the pages
    await processNextPage();
  } catch (error) {
    console.error('Multi-page extraction error:', error);
    reportExtractionError(error.message);
  }
}

// Process the next page in the queue
async function processNextPage() {
  // Check if we've reached the maximum number of pages
  if (multiPageState.pageCounter >= multiPageState.maxPages) {
    finishExtraction();
    return;
  }
  
  // Check if we have any pending URLs
  if (multiPageState.pendingUrls.length === 0) {
    finishExtraction();
    return;
  }
  
  // Get the next URL to process
  const url = multiPageState.pendingUrls.shift();
  
  // Skip if we've already visited this URL
  if (multiPageState.visitedUrls.has(url)) {
    await processNextPage();
    return;
  }
  
  // Mark as visited
  multiPageState.visitedUrls.add(url);
  
  try {
    // Navigate to the page
    const tab = await createTab(url);
    
    // Wait for page to load completely
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract data from the page
    const extractedData = await extractDataFromTab(tab.id);
    
    // Process the extracted data
    processExtractedData(extractedData);
    
    // Increment the page counter
    multiPageState.pageCounter++;
    
    // Send progress update
    sendProgressUpdate();
    
    // Get the next page link if this is a search results page
    if (multiPageState.depth < multiPageState.maxDepth) {
      if (multiPageState.options.followLinks) {
        await collectLinksFromTab(tab.id);
      }
      
      const nextPageLink = await getNextPageLink(tab.id);
      if (nextPageLink && !multiPageState.visitedUrls.has(nextPageLink)) {
        // Add next page with higher priority (at the beginning)
        multiPageState.pendingUrls.unshift(nextPageLink);
      }
    }
    
    // Close the tab
    await closeTab(tab.id);
    
    // Process the next page
    await processNextPage();
  } catch (error) {
    console.error('Error processing page:', url, error);
    // Continue with the next URL despite the error
    await processNextPage();
  }
}

// Create a new tab with the given URL
function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

// Close a tab
function closeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Extract data from a tab
function extractDataFromTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'extractData',
      options: multiPageState.options
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error('Failed to extract data from page'));
      }
    });
  });
}

// Collect links from a tab
async function collectLinksFromTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'getLinks'
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        // Filter links based on the current depth
        if (multiPageState.depth < multiPageState.maxDepth) {
          // Add links to pendingUrls
          response.links.forEach(link => {
            if (!multiPageState.visitedUrls.has(link)) {
              multiPageState.pendingUrls.push(link);
            }
          });
          
          // Increment depth for these new links
          multiPageState.depth++;
        }
        resolve();
      } else {
        reject(new Error('Failed to get links from page'));
      }
    });
  });
}

// Get the next page link
function getNextPageLink(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'getNextPageLink'
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response.nextPageLink);
      } else {
        reject(new Error('Failed to get next page link'));
      }
    });
  });
}

// Process the extracted data
function processExtractedData(data) {
  // Merge with existing results
  if (data.emails && data.emails.length > 0) {
    multiPageState.results.emails = [...multiPageState.results.emails, ...data.emails];
  }
  
  if (data.phones && data.phones.length > 0) {
    multiPageState.results.phones = [...multiPageState.results.phones, ...data.phones];
  }
  
  if (data.social && data.social.length > 0) {
    multiPageState.results.social = [...multiPageState.results.social, ...data.social];
  }
  
  // Remove duplicates if option is set
  if (multiPageState.options.removeDuplicates) {
    multiPageState.results.emails = [...new Set(multiPageState.results.emails)];
    multiPageState.results.phones = [...new Set(multiPageState.results.phones)];
    multiPageState.results.social = [...new Set(multiPageState.results.social)];
  }
  
  // Send intermediate results to popup
  sendExtractionResult();
}

// Send progress update to popup
function sendProgressUpdate() {
  chrome.runtime.sendMessage({
    action: 'extractionProgress',
    current: multiPageState.pageCounter,
    total: multiPageState.maxPages
  });
}

// Send extraction result to popup
function sendExtractionResult() {
  chrome.runtime.sendMessage({
    action: 'extractionResult',
    data: multiPageState.results,
    pagesScanned: multiPageState.pageCounter
  });
}

// Report extraction error to popup
function reportExtractionError(error) {
  chrome.runtime.sendMessage({
    action: 'extractionError',
    error: error
  });
  
  multiPageState.isRunning = false;
}

// Finish the extraction process
function finishExtraction() {
  // Send final results
  sendExtractionResult();
  
  // Send completion message
  chrome.runtime.sendMessage({
    action: 'extractionComplete',
    pagesScanned: multiPageState.pageCounter
  });
  
  // Reset state
  multiPageState.isRunning = false;
}