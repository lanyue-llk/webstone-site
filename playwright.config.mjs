import { defineConfig } from '@playwright/test';

const origin=process.env.SITE_ORIGIN;
export default defineConfig({
  testDir:'./tests/browser',
  timeout:90_000,
  globalTimeout:10*60_000,
  workers:2,
  forbidOnly:Boolean(process.env.CI),
  retries:0,
  reporter:'list',
  use:{baseURL:origin??'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:origin?undefined:{command:'python3 -m http.server 4173 --bind 127.0.0.1 --directory web/out',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,stderr:'ignore'},
  projects:['en','zh'].flatMap(language=>[
    {name:`desktop-${language}`,use:{viewport:{width:1600,height:1000}},metadata:{language}},
    {name:`phone-${language}`,use:{viewport:{width:390,height:900}},metadata:{language}},
  ]),
});
