const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const baseUrl = 'http://localhost:5173';
  
  console.log('Starting screenshot capture...');

  try {
    // Navigate to the site
    console.log('1. Navigating to Welcome page...');
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    // Capture the welcome modal
    await page.screenshot({ path: path.join(screenshotsDir, '01-welcome.png'), fullPage: true });
    console.log('✓ Welcome modal captured');

    // Try multiple methods to close the modal
    console.log('Attempting to close welcome modal...');
    
    // Method 1: Click "Continue without code"
    try {
      await page.waitForSelector('text/Continue without code', { timeout: 3000 });
      await page.click('text/Continue without code');
      await page.waitForTimeout(1000);
      console.log('✓ Clicked "Continue without code"');
    } catch (e) {
      console.log('Method 1 failed, trying next...');
    }

    // Method 2: Look for skip/close buttons
    try {
      const skipButton = await page.$('button:has-text("Skip")');
      if (skipButton) {
        await skipButton.click();
        await page.waitForTimeout(1000);
        console.log('✓ Clicked skip button');
      }
    } catch (e) {
      console.log('Method 2 failed, trying next...');
    }

    // Method 3: Press Escape key
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      console.log('✓ Pressed Escape');
    } catch (e) {
      console.log('Method 3 failed, trying next...');
    }

    // Method 4: Click outside the modal (backdrop)
    try {
      await page.evaluate(() => {
        const backdrop = document.querySelector('[data-radix-dialog-overlay], .dialog-overlay, [class*="overlay"]');
        if (backdrop) {
          backdrop.click();
        }
      });
      await page.waitForTimeout(1000);
      console.log('✓ Clicked backdrop');
    } catch (e) {
      console.log('Method 4 failed, trying next...');
    }

    // Method 5: Find and click any close button
    try {
      const closeSelectors = [
        'button[aria-label="Close"]',
        'button.close',
        '[data-dialog-close]',
        'button:has-text("×")',
        'button:has-text("Close")'
      ];
      
      for (const selector of closeSelectors) {
        try {
          await page.click(selector, { timeout: 1000 });
          await page.waitForTimeout(1000);
          console.log(`✓ Clicked ${selector}`);
          break;
        } catch (e) {
          // Try next selector
        }
      }
    } catch (e) {
      console.log('Method 5 failed');
    }

    // Wait a bit to ensure modal is closed
    await page.waitForTimeout(2000);

    // 2. Home Page
    console.log('2. Capturing Home page...');
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '02-home.png'), fullPage: true });

    // 3. About Page
    console.log('3. Capturing About page...');
    await page.goto(`${baseUrl}/about`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '03-about.png'), fullPage: true });

    // 4. Our System Page
    console.log('4. Capturing Our System page...');
    await page.goto(`${baseUrl}/system`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '04-system.png'), fullPage: true });

    // 5. Our Formulation Page
    console.log('5. Capturing Our Formulation page...');
    await page.goto(`${baseUrl}/formulation`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '05-formulation.png'), fullPage: true });

    // 6. Shop Page
    console.log('6. Capturing Shop page...');
    await page.goto(`${baseUrl}/shop`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '06-shop.png'), fullPage: true });

    // 7. Product Detail Page
    console.log('7. Capturing Product detail page...');
    // Try clicking a product first
    try {
      const productCards = await page.$$('a[href*="/product/"], .product-card a, [class*="product"] a');
      if (productCards.length > 0) {
        await productCards[0].click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 });
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      // If clicking fails, navigate directly
      await page.goto(`${baseUrl}/product/1`, { waitUntil: 'networkidle2', timeout: 10000 });
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: path.join(screenshotsDir, '07-product-detail.png'), fullPage: true });

    // 8. Reviews Page
    console.log('8. Capturing Reviews page...');
    await page.goto(`${baseUrl}/reviews`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '08-reviews.png'), fullPage: true });

    // 9. Contact Page
    console.log('9. Capturing Contact page...');
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '09-contact.png'), fullPage: true });

    // 10. Add to cart and Cart Page
    console.log('10. Adding product to cart and capturing Cart page...');
    await page.goto(`${baseUrl}/shop`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    
    try {
      const addToCartButtons = await page.$$('button:has-text("Add to Cart"), button[aria-label*="Add"], button[class*="cart"]');
      if (addToCartButtons.length > 0) {
        await addToCartButtons[0].click();
        await page.waitForTimeout(2000);
        console.log('✓ Added product to cart');
      }
    } catch (e) {
      console.log('Could not add to cart, continuing...');
    }
    
    await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '10-cart.png'), fullPage: true });

    // 11. Checkout Page
    console.log('11. Capturing Checkout page...');
    await page.goto(`${baseUrl}/checkout`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '11-checkout.png'), fullPage: true });

    console.log('\n✓ All screenshots captured successfully!');
    console.log(`Screenshots saved to: ${screenshotsDir}`);

  } catch (error) {
    console.error('Error capturing screenshots:', error);
  } finally {
    await browser.close();
  }
})();
