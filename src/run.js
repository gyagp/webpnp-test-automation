const fs = require('fs');
const os = require('os');
const fsPromises = fs.promises;
const path = require('path');
const runSpeedometer2 = require('./workloads/speedometer2.js');
const runWebXPRT3 = require('./workloads/webxprt3.js');
const runWebXPRT2015 = require('./workloads/webxprt2015.js');
const runUnity3D = require('./workloads/unity3d.js');
const runJetStream2 = require('./workloads/jetstream2.js');
const runAquarium = require('./workloads/aquarium.js');
const runBasemark = require('./workloads/basemark.js');
const runTensorflow = require('./workloads/tensorflow.js');
const settings = require('../config.json');
const Client = require('ssh2-sftp-client');

function getPlatformName() {
  let platform = os.platform();

  if (platform === 'win32') {
    return 'Windows';
  } else {
    return 'Linux';
  }
}

/*
* Sort the score object array by specific key and get the medium one.
*/
function sortScores(scoresArray, score, propertyName) {
  scoresArray.sort((a, b) => {
    return Number.parseFloat(a[score][propertyName]) - Number.parseFloat(b[score][propertyName]);
  });
}

/*
* Run a workload several times and sort 
*/
async function runWorkload(workload, executor) {
  let originScoresArray = [];
  let scoresArray = [];
  const flags = settings.chrome_flags;
  // if workload === unity3D || Speedometer2, warm up
  if (workload.name === "Unity3D" || workload.name === "Speedometer2") {
    await executor(workload, flags);
    await new Promise(resolve => setTimeout(resolve, 100 * 1000)); // sleep for a while before next time running
  }
  for (let i = 0; i < workload.run_times; i++) {
    let thisScore = await executor(workload, flags);
    originScoresArray.push(thisScore);
    scoresArray.push(thisScore);

    await new Promise(resolve => setTimeout(resolve, workload.sleep_interval * 1000)); // sleep for a while before next time running
  }

  sortScores(scoresArray, 'scores', 'Total Score');
  const middleIndex = Math.round((workload.run_times - 1) / 2);

  let selectedRound = -1;
  for (let i = 0; i < originScoresArray.length; i++) {
    if (scoresArray[middleIndex] === originScoresArray[i])
      selectedRound = i;
  }

  return Promise.resolve({
    'middle_score': scoresArray[middleIndex],
    'selected_round': selectedRound,
    'detailed_scores': originScoresArray
  });
}

/*
*   Generate a JSON file to store this test result
*   Return: The absolute pathname of the JSON file
*/
async function storeTestData(deviceInfo, workload, jsonData) {
  let testResultsDir = path.join(process.cwd(), 'results', getPlatformName(), workload.name);
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, {recursive: true});
  }

  let cpuInfo = [deviceInfo['CPU']['mfr'], deviceInfo['CPU']['info'].replace(/\s/g, '-')].join('-');
  let date = new Date();
  let isoDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  let jsonDate = isoDate.toISOString().split('.')[0].replace(/T|-|:/g, '');
  let browser = deviceInfo['Browser'];
  let jsonFilename = jsonDate + '_' + cpuInfo + '_' + browser + '.json';
  let absJSONFilename = path.join(testResultsDir, jsonFilename);

  await fsPromises.writeFile(absJSONFilename, JSON.stringify(jsonData, null, 4));
  return Promise.resolve(absJSONFilename);
}

/*
* Call a workload and generate the JSON file to store the test results
* Return: The absolute path name of the JSON file.
*/

async function genWorkloadResult(deviceInfo, workload, executor) {
  // if (!settings.dev_mode) {
  //   await syncRemoteDirectory(workload, 'pull');
  // }
  let results = await runWorkload(workload, executor);
  let jsonData = {
    'workload': workload.name,
    'device_info': deviceInfo,
    'test_result': results.middle_score.scores,
    'selected_round': results.selected_round,
    'test_rounds': results.detailed_scores,
    'chrome_flags': settings.chrome_flags,
    'execution_date': results.middle_score.date
  }
  console.log(JSON.stringify(jsonData, null, 4));

  let jsonFilename = await storeTestData(deviceInfo, workload, jsonData);
  // if (!settings.dev_mode) {
  //   await syncRemoteDirectory(workload, 'push');
  // }
  return Promise.resolve(jsonFilename);
}

/*
* Sync local test results directory with the one in remote server.
*/
async function syncRemoteDirectory(workload, action) {
  let testResultsDir = path.join(process.cwd(), 'results', getPlatformName(), workload.name);
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, {recursive: true});
  }
  let localResultFiles = await fsPromises.readdir(testResultsDir);

  const serverConfig = {
    host: settings.result_server.host,
    username: settings.result_server.username,
    password: settings.result_server.password
  };

  let currentPlatform = getPlatformName();
  let remoteResultDir = `/home/${settings.result_server.username}/webpnp/results/${currentPlatform}/${workload.name}`;
  let sftp = new Client();
  try {
    await sftp.connect(serverConfig);
    let remoteResultDirExist = await sftp.exists(remoteResultDir);
    if (!remoteResultDirExist) {
      await sftp.mkdir(remoteResultDir, true);
    }

    let remoteResultFiles = await sftp.list(remoteResultDir);

    if (action === 'pull') {
      for (let remoteFile of remoteResultFiles) {
        if (!fs.existsSync(path.join(testResultsDir, remoteFile.name))) {
          console.log(`Downloading remote file: ${remoteFile.name}...`);
          await sftp.fastGet(remoteResultDir + '/' + remoteFile.name,
                            path.join(testResultsDir, remoteFile.name));
          console.log(`Remote file: ${remoteFile.name} downloaded.`);
        }
      }
    } else if (action === 'push') {
      for (let localFile of localResultFiles) {
        let absRemoteFilename = remoteResultDir + `/${localFile}`;
        let remoteFileExist = await sftp.exists(absRemoteFilename);
        if (!remoteFileExist) {
          console.log(`Uploading local file: ${localFile}`);
          await sftp.fastPut(path.join(testResultsDir, localFile), absRemoteFilename);
          console.log(`${localFile} uploaded to remote server.`);
        }
      }
    }
  } catch (err) {
    console.log(err);
  } finally {
    await sftp.end();
  }

  return Promise.resolve(testResultsDir);
}

/*
* Note: Specific for regular weekly testing
* Search test results for one round of regular testing
* with keywords of 'cpu', 'browser channel',
* and 'browser version'.
* Return: {Object}, like {
*   'Speedometer2': 'path/to/json/file',
*   ...
* }
*/
async function searchTestResults(cpu, browserChannel, browserVersion) {
  let results = {};
  for (let workload of settings.workloads) {
    let testResultDir = await syncRemoteDirectory(workload, 'pull');
    let resultFiles = await fs.promises.readdir(testResultDir);
    let result = [];
    for (let file of resultFiles) {
      if (file.includes(cpu) && file.includes(browserChannel) && file.includes(browserVersion))
        result.push(file);
    }
    if(result.length !== 1)
      return Promise.reject(`Error: unexpected result length: ${result.length}`);
    results[workload.name] = path.join(testResultDir, result[0]);
  }
  console.log(results);
  return Promise.resolve(results);
}

/**
 * Pull all workloads results from host server
 */
async function pullRemoteResults() {
  for (let workload of settings.workloads) {
    await syncRemoteDirectory(workload, 'pull');
  }
  return Promise.resolve();
}
/*
* Run all the workloads defined in ../config.json and 
* generate the results to the ../results directory.
* Return: an object like {
*   'Speedometer2': 'path/to/json/file',
*   ...
* }
*/
async function genWorkloadsResults(deviceInfo) {

  let results = {};
  let executors = {
    'Speedometer2': runSpeedometer2,
    'WebXPRT3': runWebXPRT3,
    'WebXPRT2015': runWebXPRT2015,
    'Unity3D': runUnity3D,
    'JetStream2': runJetStream2,
    'Aquarium': runAquarium,
    'BaseMark': runBasemark,
    'TensorFlow_Wasm': runTensorflow,
    'TensorFlow_WebGL_ResNet': runTensorflow,
    'TensorFlow_WebGPU_ResNet': runTensorflow,
    'TensorFlow_WebGL_MobileNet': runTensorflow,
    'TensorFlow_WebGPU_MobileNet': runTensorflow
  };
  for (const workload of settings.workloads) {
    let executor = executors[workload.name];
    results[workload.name] = await genWorkloadResult(deviceInfo, workload, executor);
  }

  return Promise.resolve(results);
}


module.exports = {
  getPlatformName: getPlatformName,
  genWorkloadsResults: genWorkloadsResults
}
