// Content script for advanced email extractor

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractData") {
    // Extract data from the current page
    const extractedData = extractDataFromPage(request.options);
    
    // Send response back
    sendResponse({ success: true, data: extractedData });
  } else if (request.action === "getLinks") {
    // Get all links from the current page
    const links = getAllLinks();
    sendResponse({ success: true, links: links });
  } else if (request.action === "getNextPageLink") {
    // Try to find the "Next" page link for search results
    const nextPageLink = findNextPageLink();
    sendResponse({ success: true, nextPageLink: nextPageLink });
  }
  
  return true; // Keep the message channel open for async response
});

// Function to extract data from the page
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
    
    extractedData.emails = matches;
  }
  
  // Extract phone numbers if enabled
  if (options.extractPhones) {
    const matches = pageContent.match(phoneRegex) || [];
    extractedData.phones = matches;
  }
  
  // Extract social media profiles if enabled
  if (options.extractSocial) {
    let socialProfiles = [];
    
    // Search for social media links in the HTML
    for (const [platform, regex] of Object.entries(socialRegexPatterns)) {
      const matches = pageHTML.match(regex) || [];
      socialProfiles = [...socialProfiles, ...matches];
    }
    
    extractedData.social = socialProfiles;
  }
  
  return extractedData;
}

// Get all links from the current page
function getAllLinks() {
  const links = Array.from(document.querySelectorAll('a'))
    .map(a => a.href)
    .filter(href => href && href.startsWith('http'));
  
  return [...new Set(links)]; // Remove duplicates
}

// Try to find the "Next" page link for pagination
function findNextPageLink() {
  // Common next page link patterns
  const nextPatterns = [
    // Text patterns
    'next', 'next page', 'load more', 'show more', 'more results',
    // CSS classes/IDs that often indicate next buttons
    'pagination-next', 'pagination__next', 'pager-next', 'next-page',
    // Arrow symbols
    '»', '›', '→', '⟩'
  ];
  
  // First check for elements with aria-label attributes
  const ariaNextLinks = Array.from(document.querySelectorAll('[aria-label*="next" i], [aria-label*="Next" i]'));
  if (ariaNextLinks.length > 0) {
    for (const link of ariaNextLinks) {
      if (link.href) return link.href;
    }
  }
  
  // Then check for elements with common text patterns
  const allLinks = Array.from(document.querySelectorAll('a'));
  for (const pattern of nextPatterns) {
    for (const link of allLinks) {
      const text = link.textContent.trim().toLowerCase();
      if (text.includes(pattern.toLowerCase()) && link.href) {
        return link.href;
      }
    }
  }
  
  // For Google search specifically
  if (window.location.href.includes('google.com/search')) {
    const googleNextLink = document.querySelector('#pnnext, a.pn');
    if (googleNextLink && googleNextLink.href) {
      return googleNextLink.href;
    }
  }
  
  // For Bing search
  if (window.location.href.includes('bing.com/search')) {
    const bingNextLink = document.querySelector('a.sb_pagN');
    if (bingNextLink && bingNextLink.href) {
      return bingNextLink.href;
    }
  }
  
  return null;
}