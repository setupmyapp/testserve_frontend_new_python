// otp-automation.js - Runs on Gmail to extract OTPs

console.log('📧 OTP Automation script loaded on:', window.location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extractOtp') {
        console.log('📧 Received request to extract OTP');
        findAndExtractOtp(message.searchTerms || ['OTP', 'Verification', 'Code'])
            .then(otp => sendResponse({ success: true, otp }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
});

async function findAndExtractOtp(searchTerms) {
    console.log('📧 Searching for OTP with terms:', searchTerms);

    // Wait a moment for Gmail to load fresh emails
    await wait(2000);

    // 1. Try to find recent unread emails in the inbox list
    const rows = document.querySelectorAll('.zA'); // Standard Gmail row class
    console.log(`📧 Found ${rows.length} email rows`);

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const row = rows[i];
        const text = row.innerText || '';

        console.log(`📧 Checking email ${i + 1}: ${text.substring(0, 50)}...`);

        // Check if matches search terms or is just very recent
        // For now, we assume the top email is the one we want if it looks relevant
        // or if we just triggered it.

        // Extract 6 digit code
        const otpMatch = text.match(/\b\d{6}\b/);
        if (otpMatch) {
            console.log('✅ Found OTP in email list snippet:', otpMatch[0]);
            return otpMatch[0];
        }

        // If not in snippet, maybe we need to open it?
        // Let's try opening the first one if we didn't find it in snippet
        if (i === 0) {
            console.log('📧 Opening first email to check content...');
            row.click();
            await wait(1000);

            // Look in the open email body
            const emailBody = document.querySelector('.a3s.aiL'); // Email body container
            if (emailBody) {
                const bodyText = emailBody.innerText;
                const bodyMatch = bodyText.match(/\b\d{6}\b/);
                if (bodyMatch) {
                    console.log('✅ Found OTP in email body:', bodyMatch[0]);
                    return bodyMatch[0];
                }
            }

            // Go back to inbox? Not strictly necessary if we close the tab later.
        }
    }

    throw new Error('OTP not found in recent emails');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
