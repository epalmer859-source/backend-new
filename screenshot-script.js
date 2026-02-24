const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  // Create screenshots directory if it doesn't exist
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const baseUrl = 'http://localhost:5173';
  
  console.log('Starting screenshot capture...');

  try {
    // 1. Welcome Page
    console.log('1. Capturing Welcome page...');
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '01-welcome.png'), fullPage: true });
    
    // Try to find and click skip or enter button
    try {
      const skipButton = await page.$('button:has-text("Skip")') || await page.$('button:has-text("Enter")') || await page.$('input[type="email"] ~ button');
      if (skipButton) {
        await skipButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 });
      }
    } catch (e) {
      console.log('No skip/enter button found, proceeding...');
    }

    // 2. Home Page
    console.log('2. Capturing Home page...');
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '02-home.png'), fullPage: true });

    // 3. About Page
    console.log('3. Capturing About page...');
    await page.goto(`${baseUrl}/about`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '03-about.png'), fullPage: true });

    // 4. Our System Page
    console.log('4. Capturing Our System page...');
    await page.goto(`${baseUrl}/system`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '04-system.png'), fullPage: true });

    // 5. Our Formulation Page
    console.log('5. Capturing Our Formulation page...');
    await page.goto(`${baseUrl}/formulation`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '05-formulation.png'), fullPage: true });

    // 6. Shop Page
    console.log('6. Capturing Shop page...');
    await page.goto(`${baseUrl}/shop`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '06-shop.png'), fullPage: true });

    // 7. Product Detail Page (click first product)
    console.log('7. Capturing Product detail page...');
    try {
      const productLink = await page.$('a[href*="/product/"]');
      if (productLink) {
        await productLink.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 });
        await page.screenshot({ path: path.join(screenshotsDir, '07-product-detail.png'), fullPage: true });
      }
    } catch (e) {
      console.log('Could not capture product detail, trying direct URL...');
      await page.goto(`${baseUrl}/product/1`, { waitUntil: 'networkidle2', timeout: 10000 });
      await page.screenshot({ path: path.join(screenshotsDir, '07-product-detail.png'), fullPage: true });
    }

    // 8. Reviews Page
    console.log('8. Capturing Reviews page...');
    await page.goto(`${baseUrl}/reviews`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '08-reviews.png'), fullPage: true });

    // 9. Contact Page
    console.log('9. Capturing Contact page...');
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '09-contact.png'), fullPage: true });

    // 10. Add to cart and Cart Page
    console.log('10. Adding product to cart and capturing Cart page...');
    await page.goto(`${baseUrl}/shop`, { waitUntil: 'networkidle2', timeout: 10000 });
    try {
      const addToCartButton = await page.$('button:has-text("Add to Cart")') || await page.$('button[class*="cart"]');
      if (addToCartButton) {
        await addToCartButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log('Could not add to cart');
    }
    await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '10-cart.png'), fullPage: true });

    // 11. Checkout Page
    console.log('11. Capturing Checkout page...');
    await page.goto(`${baseUrl}/checkout`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, '11-checkout.png'), fullPage: true });

    console.log('All screenshots captured successfully!');
    console.log(`Screenshots saved to: ${screenshotsDir}`);

  } catch (error) {
    console.error('Error capturing screenshots:', error);
  } finally {
    await browser.close();
  }
})();
