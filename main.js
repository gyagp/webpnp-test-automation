"use strict";

const genDeviceInfo = require('./src/get_device_info.js');
const runTest = require('./src/run.js');
const browser = require('./src/browser.js');
const genTestReport = require('./src/gen_single_report.js');
const sendMail = require('./src/send_mail.js');
const settings = require('./config.json');
const excel = require('./src/excel.js');
const chart = require('./src/chart.js');
const cron = require('node-cron');
const moment = require('moment');
const os = require('os');
const GetChromiumBuild = require('./src/get_chromium_build.js');
//const repo = require('./src/tfjs_repo.js');

const args = require('yargs')
  .usage('node $0 [args]')
  .option('email', {
    type: 'string',
    describe: 'email to',
  })
  .option('update-chrome', {
    type: 'boolean',
    describe: 'Update chrome',
  })
  .help()
  .argv

const cpuModel = os.cpus()[0].model;
const platform = runTest.getPlatformName();

async function main() {
  //await browser.updateChrome();
  //await repo.updateTFJS();

  let now = moment();
  const weekAndDay = now.week() + '.' + now.day();

  let deviceInfo = {};
  let subject = "";
  try {
    // Clean up chart folder
    // await chart.cleanUpChartFiles();
    // Use private chroimum build if chromium build is enabled
    if (settings["chromium_builder"]["enable_chromium_build"]) {
      const commitId = settings["chromium_builder"]["commit_id"];
      if (commitId !== "") {
        subject = `Web auto test report on ${platform} with commit id: ${commitId}`;
        await GetChromiumBuild(commitId);
      } else {
        throw Error("Commit id should be specific in config.json if you run with chromium build");
      }
    }

    deviceInfo = await genDeviceInfo();
    if (subject === "")
      subject = '[W' + weekAndDay + '] TFJS auto test report - ' + platform + ' - ' + deviceInfo["CPU"]["info"] + ' - ' + deviceInfo.Browser;
    console.log("Subject: ", subject);
    // in dev mode, check browser version will be skipped.
    // if (!settings.dev_mode) {
    //   await browser.checkBrowserVersion(deviceInfo);
    // }
    const workloadResults = await runTest.genWorkloadsResults(deviceInfo);
    // const workloadResults = await runTest.searchTestResults("Intel-TGL", "Canary", "86.0.4207");
    console.log(JSON.stringify(workloadResults, null, 4));
    // if (!settings.dev_mode) {
    //   // Upload each testing result as excel to webpnp test reporter
    //   const remoteExcelPathName = await excel.genExcelFilesAndUpload(workloadResults);
    //   await excel.remoteExecUploadScript(remoteExcelPathName); // upload the .xlsx data
    // }

    let chartImages = [];
    // only attach the trend charts for regular weekly testing
    // Since AMD testing is before Intel, downloading charts is available after Intel testing done.
    // if (cpuModel.includes('Intel') && !settings.dev_mode) {
    //   await chart.dlCharts(deviceInfo);
    //   chartImages = await chart.getChartFiles();
    //   console.log(chartImages);
    // }

    // Pull all results to make sure getting latest results of competitors
    // await runTest.pullRemoteResults();
    const testReports = await genTestReport(workloadResults);

    console.log(subject);

    if ('email' in args)
      await sendMail(args['email'], subject, testReports, chartImages);
  } catch (err) {

    console.log(err);
    let subject = '[W' + weekAndDay + ']';
    if (!settings.dev_mode && err.message.includes('No new browser update')) {
      subject += 'Auto test cancelled on ' + platform + ' as no browser update';
    } else {
      subject += 'Auto test failed on ' + platform + '-' + cpuModel;
    }

    console.log(subject);
    if ('email' in args)
      await sendMail(args['email'], subject, err, 'failure_notice');
  }

  // Update the browser version in config.json if necessary
  // await browser.updateConfig(deviceInfo, settings);
  // await chart.cleanUpChartFiles();

}

if (settings.enable_cron) {
  cron.schedule(settings.update_browser_sched, () => {
    browser.updateChrome();
    //repo.updateTFJS();
  });
  if (cpuModel.includes('Intel')) {
    cron.schedule(settings.intel_test_cadence, async () => {
      settings.chrome_flags = ["--enable-unsafe-webgpu", "--enable-dawn-features=disable_robustness",
    "--enable-features=WebAssemblySimd,WebAssemblyThreads"];
      await main();
      // settings.chrome_flags = ["--enable-unsafe-webgpu","--enable-features=WebAssemblySimd,WebAssemblyThreads"];
      // await main();
    });
  } else {
    cron.schedule(settings.amd_test_cadence, () => {
      main();
    });
  }
} else {
  if ('update-chrome' in args)
    browser.updateChrome();

  settings.chrome_flags = ["--enable-unsafe-webgpu", "--enable-dawn-features=disable_robustness",
    "--enable-features=WebAssemblySimd,WebAssemblyThreads"];
  // main().then(() => {
  //   settings.chrome_flags = ["--enable-unsafe-webgpu", "--enable-features=WebAssemblySimd,WebAssemblyThreads"];
  //   main();
  // });
  main();
}
