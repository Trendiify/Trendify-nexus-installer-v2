# Trendify Nexus V2

<p align="center">
  <a href="https://trendv2.pages.dev/">
    <img src="https://img.shields.io/badge/🚀_اجرای_Installer-شروع_نصب-635BFF?style=for-the-badge" alt="اجرای Installer">
  </a>
</p>

<p align="center">
  <a href="#راهنمای-فارسی">
    <img src="https://img.shields.io/badge/🇮🇷_فارسی-راهنمای_نصب-239B56?style=for-the-badge" alt="راهنمای فارسی">
  </a>
  <a href="#english-guide">
    <img src="https://img.shields.io/badge/🇬🇧_English-Installation_Guide-2463EB?style=for-the-badge" alt="English guide">
  </a>
</p>

---

# راهنمای فارسی

## ۱. شروع نصب

برای اجرای نصب‌کننده آنلاین روی دکمه زیر کلیک کن:

**[🚀 اجرای Trendify Nexus Installer](https://trendv2.pages.dev/)**

قبل از اجرا، توکن‌های GitHub و Cloudflare را مطابق راهنمای زیر آماده کن.

## ۲. ساخت توکن GitHub

۱. وارد صفحه زیر شو:

[ساخت Fine-grained personal access token در GitHub](https://github.com/settings/personal-access-tokens/new)

۲. برای توکن یک نام دلخواه انتخاب کن.

۳. در بخش **Repository access** گزینه زیر را انتخاب کن:

**All repositories**

۴. در بخش **Permissions**، مجوزهای زیر را تنظیم کن:

| Permission | Access |
|---|---|
| Administration | Read and write |
| Contents | Read and write |
| Metadata | Read-only |

**نکته:** برای `Metadata` سطح دسترسی `Read-only` را انتخاب کن؛ این مجوز گزینه `Write` ندارد. برای `Administration` و `Contents`، سطح `Read and write` را انتخاب کن.

۵. در پایین صفحه روی **Generate token** کلیک کن.

۶. توکن تولیدشده را همان لحظه کپی و در محل امن نگهداری کن. GitHub معمولاً پس از خروج از صفحه، مقدار کامل توکن را دوباره نمایش نمی‌دهد.

## ۳. ساخت توکن Cloudflare

۱. وارد صفحه زیر شو:

[ساخت Cloudflare API Token](https://dash.cloudflare.com/profile/api-tokens)

۲. روی **Create Token** کلیک کن و در صورت امکان گزینه **Create Custom Token** را انتخاب کن.

۳. یک نام دلخواه برای توکن وارد کن.

۴. فقط مجوزهای موردنیاز زیر را اضافه کن:

| Permission | Access |
|---|---|
| Workers Scripts | Edit |
| Account Settings | Read |

۵. در بخش **Account Resources**، حساب Cloudflare موردنظر را انتخاب کن.

۶. تنظیمات را بررسی و توکن را ایجاد کن.

۷. توکن را کپی کن و در محل امن نگه دار.

**مهم:** مجوزهای بالا برای تنظیم موردنظر این راهنما هستند. اگر Installer یا API هنگام اعتبارسنجی یا استقرار خطای مجوز داد، متن خطا را بررسی کن؛ ممکن است کد فعلی به مجوز دیگری هم نیاز داشته باشد.

## ۴. اجرای Installer

پس از آماده‌کردن اطلاعات:

۱. [وارد Installer شو](https://trendv2.pages.dev/).

۲. مقدار GitHub Token را وارد کن.

۳. مقدار Cloudflare API Token را وارد کن.

۴. مقدار Cloudflare Account ID را وارد کن.

۵. روی دکمه شروع نصب کلیک کن.

۶. تا پایان عملیات صبر کن و نتیجه نمایش‌داده‌شده را ذخیره کن.

اطلاعات خروجی ممکن است شامل لینک مخزن یا اطلاعات محرمانه موردنیاز برای ادامه راه‌اندازی باشد. Secretها را عمومی نکن.

## ۵. راه‌اندازی PostgreSQL

دیتابیس PostgreSQL باید از طریق سرویس‌دهنده موردنظر ایجاد شود.

۱. یک دیتابیس PostgreSQL بساز.

۲. آدرس اتصال آن را دریافت کن.

۳. در تنظیمات متغیرهای محیطی سرویس Backend در Railway، مقدار `DATABASE_URL` را تنظیم کن.

۴. سرویس را مجدداً اجرا کن و لاگ‌ها را بررسی کن.

از آدرس اتصال واقعی دیتابیس استفاده کن و آن را در GitHub منتشر نکن.

## ۶. راه‌اندازی Railway و Relay

Backend و Relay را طبق ساختار مخازن تولیدشده و کد پروژه در Railway مستقر کن.

متغیرهای محیطی را با توجه به کد هر سرویس تنظیم کن. بسته به پیاده‌سازی، متغیرهای موردنیاز ممکن است شامل موارد زیر باشند:

- `DATABASE_URL`
- `CF_TOKEN`
- `CF_ACCOUNT_ID`
- `PUBLIC_URL`
- `NEXUS_GATEWAY_SECRET`
- `RAILWAY_TCP_PROXY_DOMAIN`
- `RAILWAY_TCP_PROXY_PORT`

همه متغیرها برای همه سرویس‌ها لازم نیستند؛ هر متغیر باید در سرویس مربوط به خودش قرار بگیرد.

## ۷. تنظیم Railway TCP Proxy

اگر Relay از TCP Proxy استفاده می‌کند:

۱. TCP Proxy سرویس Relay را در Railway فعال یا ایجاد کن.

۲. Host و Port عمومی اختصاص‌یافته را کپی کن.

۳. مقادیر واقعی را در متغیرهای مربوط به Gateway قرار بده؛ نام متغیرها باید با کد Gateway مطابقت داشته باشد.

۴. مطمئن شو پورت Relay با تنظیمات سرویس هماهنگ است.

۵. مقدار `RELAY_SECRET` در Gateway و Relay را یکسان تنظیم کن.

مقدار `NEXUS_GATEWAY_SECRET` برای احراز هویت Backend و Gateway با `RELAY_SECRET` یکی نیست، مگر اینکه کد پروژه صراحتاً چنین طراحی‌ای داشته باشد.

## ۸. بررسی نهایی

پس از تکمیل تنظیمات:

- وضعیت اجرای Backend را بررسی کن.
- اتصال PostgreSQL را آزمایش کن.
- لاگ‌های Relay را بررسی کن.
- از انتشار صحیح Cloudflare Worker مطمئن شو.
- ارتباط Gateway و Relay را آزمایش کن.

نمایش موفقیت در Installer به معنی تکمیل خودکار تمام تنظیمات دستی نیست.

## نکات امنیتی

- توکن‌های GitHub و Cloudflare را منتشر نکن.
- `DATABASE_URL` و Secretها را در اختیار دیگران قرار نده.
- فایل‌های `.env` حاوی اطلاعات محرمانه را کامیت نکن.
- اگر توکنی افشا شد، آن را لغو و توکن جدید ایجاد کن.

---

# English Guide

## 1. Launch the Installer

Click the button below to open the online installer:

**[🚀 Launch Trendify Nexus Installer](https://trendv2.pages.dev/)**

Prepare your GitHub and Cloudflare tokens using the instructions below before starting.

## 2. Create a GitHub Token

1. Open the following page:

   [Create a Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)

2. Enter a name for your token.

3. Under **Repository access**, select:

   **All repositories**

4. Under **Permissions**, configure these permissions:

| Permission | Access |
|---|---|
| Administration | Read and write |
| Contents | Read and write |
| Metadata | Read-only |

**Note:** Metadata is read-only and does not offer a Write option. Select Read and write for Administration and Contents.

5. Click **Generate token**.

6. Copy the generated token and store it securely. GitHub generally does not display the complete token again after you leave the page.

## 3. Create a Cloudflare API Token

1. Open:

   [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)

2. Click **Create Token** and select **Create Custom Token**, if available.

3. Enter a name for the token.

4. Add only the following permissions for this setup:

| Permission | Access |
|---|---|
| Workers Scripts | Edit |
| Account Settings | Read |

5. Under **Account Resources**, select the Cloudflare account you intend to use.

6. Review the configuration and create the token.

7. Copy the token and store it securely.

**Important:** These are the requested permissions for this guide. If the installer or API returns a permission error, review the error because the current implementation may require additional permissions.

## 4. Run the Installer

1. [Open the installer](https://trendv2.pages.dev/).
2. Enter your GitHub token.
3. Enter your Cloudflare API token.
4. Enter your Cloudflare Account ID.
5. Click the installation button.
6. Wait for the operation to finish and save the displayed results.

The output may contain repository links or private information required for the remaining setup. Never publish secrets.

## 5. Configure PostgreSQL

Create a PostgreSQL database with your preferred provider.

1. Create the database.
2. Copy its connection URL.
3. Set `DATABASE_URL` in the Railway environment variables for the backend service.
4. Restart the service and inspect its logs.

Use the actual database connection URL and never publish it in GitHub.

## 6. Deploy Railway and Relay

Deploy the Backend and Relay according to the generated repositories and the actual project source code.

Depending on the implementation, environment variables may include:

- `DATABASE_URL`
- `CF_TOKEN`
- `CF_ACCOUNT_ID`
- `PUBLIC_URL`
- `NEXUS_GATEWAY_SECRET`
- `RAILWAY_TCP_PROXY_DOMAIN`
- `RAILWAY_TCP_PROXY_PORT`

Not every variable belongs in every service. Configure each variable only where the corresponding source code requires it.

## 7. Configure the Railway TCP Proxy

If the Relay uses a TCP Proxy:

1. Enable or create the TCP Proxy for the Relay service.
2. Copy the public hostname and port assigned by Railway.
3. Configure the corresponding Gateway variables using the exact names expected by your Gateway source code.
4. Ensure that the Relay listener port matches the service configuration.
5. Make sure the Gateway and Relay use the same `RELAY_SECRET`.

The Backend/Gateway authentication secret `NEXUS_GATEWAY_SECRET` is separate from `RELAY_SECRET`, unless the implementation explicitly specifies otherwise.

## 8. Verify the Deployment

After completing the configuration:

- Check that the Backend starts successfully.
- Verify the PostgreSQL connection.
- Review Relay logs.
- Confirm that the Cloudflare Worker is deployed.
- Test the Gateway-to-Relay connection.

A successful installer response does not guarantee that every manual configuration step is complete.

## Security

- Never publish GitHub or Cloudflare tokens.
- Keep `DATABASE_URL` and authentication secrets private.
- Never commit `.env` files containing credentials.
- Revoke and replace any exposed token.

---

## Support

When requesting help, provide the relevant error message and service logs after removing all tokens, passwords, database URLs, and private secrets.

