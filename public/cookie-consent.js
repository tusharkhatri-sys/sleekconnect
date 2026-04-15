/* =============================================
   SleekConnect — Cookie Consent (GDPR/AdSense)
   ============================================= */
(function() {
    'use strict';

    const CONSENT_KEY = 'sleekconnect_cookie_consent';
    const CONSENT_VERSION = '1.0';

    function hasConsent() {
        try {
            const stored = localStorage.getItem(CONSENT_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (parsed.version !== CONSENT_VERSION) return null;
            return parsed.accepted;
        } catch (e) {
            return null;
        }
    }

    function setConsent(accepted) {
        try {
            localStorage.setItem(CONSENT_KEY, JSON.stringify({
                accepted: accepted,
                version: CONSENT_VERSION,
                timestamp: new Date().toISOString()
            }));
        } catch (e) {
            console.warn('Cookie consent could not be saved.');
        }

        if (accepted) {
            loadAdSense();
        }
    }

    function loadAdSense() {
        // Only load AdSense if consent is given
        // Replace 'ca-pub-XXXXXXXXX' with your actual AdSense publisher ID when approved
        /*
        if (!document.getElementById('adsense-script')) {
            const script = document.createElement('script');
            script.id = 'adsense-script';
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXX';
            document.head.appendChild(script);
        }
        */
    }

    function createBanner() {
        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.className = 'cookie-banner';
        banner.innerHTML = `
            <div class="cookie-text">
                🍪 We use cookies to enhance your experience and for analytics. 
                By continuing, you agree to our 
                <a href="/privacy.html">Privacy Policy</a> and 
                <a href="/terms.html">Terms of Service</a>.
            </div>
            <div class="cookie-actions">
                <button id="cookie-decline" class="cookie-btn-decline">Decline</button>
                <button id="cookie-accept" class="cookie-btn-accept">Accept All</button>
            </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('cookie-accept').addEventListener('click', function() {
            setConsent(true);
            banner.classList.add('hidden');
        });

        document.getElementById('cookie-decline').addEventListener('click', function() {
            setConsent(false);
            banner.classList.add('hidden');
        });
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        const consent = hasConsent();
        if (consent === null) {
            createBanner();
        } else if (consent === true) {
            loadAdSense();
        }
    });
})();
