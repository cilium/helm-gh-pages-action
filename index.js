const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const io = require('@actions/io');
const ioUtil = require('@actions/io/lib/io-util');

const { readdirSync } = require('fs');
const path = require('path');

const getDirectories = fileName =>
  readdirSync(fileName, {
    withFileTypes: true,
  })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => !(/(^|\/)\.[^\/\.]/g).test(dirent))
    .map(dirent => dirent.name);

async function run() {
  try {
    const accessToken = core.getInput('access-token');
    if (!accessToken) {
      core.setFailed(
        'No personal access token found. Please provide one by setting the `access-token` input for this action.'
      );
      return;
    }

    const deployBranch = core.getInput('deploy-branch');
    if (!deployBranch) deployBranch = 'master';

    const chartsDir = core.getInput('charts-folder');

    if (github.context.ref === `refs/heads/${deployBranch}`) {
      console.log(`Triggered by branch used to deploy: ${github.context.ref}.`);
      console.log('Nothing to deploy.');
      return;
    }

    const rootDir = path.resolve('./')
    const repo = core.getInput('repo') || `${github.context.repo.owner}/${github.context.repo.repo}`;
    const repoURL = `https://${accessToken}@github.com/${repo}.git`;
    console.log(`Deploying ${github.context.ref} to repo: ${repo} and branch: ${deployBranch}`);

    await exec.exec(`git clone`, ['-b', deployBranch, repoURL, 'output'], {
      cwd: './',
    });
    await exec.exec(`git config user.name`, [github.context.actor], {
      cwd: './output',
    });
    await exec.exec(
      `git config user.email`,
      [`${github.context.actor}@users.noreply.github.com`],
      { cwd: './output' }
    );

    await exec.exec(`helm init --client-only`);
    console.log('Initialized helm client');

    const chartDirectories = getDirectories(path.resolve(`./${chartsDir}`));
    for (const chartDirname of chartDirectories) {
      console.log(`Resolving helm chart dependency in directory ${chartDirname}`);
      await exec.exec(
        `helm dependency update`,
        [],
        { cwd: `./${chartsDir}/${chartDirname}` }
      );

      console.log(`Packaging helm chart in directory ${chartDirname}`);
      await exec.exec(
        `helm package`,
        [chartDirname, '--destination', `${rootDir}/output`],
        { cwd: `./${chartsDir}` }
      );
    }

    console.log('Packaged all helm charts.');
    console.log(`Building index.yaml`);

    await exec.exec(`helm repo index`, `./output`, `--merge output/index.yaml`);
    console.log(`Successfully built index.yaml.`);

    const cnameExists = await ioUtil.exists('./CNAME');
    if (cnameExists) {
      console.log('Copying CNAME over.');
      await io.cp('./CNAME', './output/CNAME', { force: true });
      console.log('Finished copying CNAME.');
    }

    await exec.exec(`git add`, ['.'], { cwd: './output' });
    await exec.exec(
      `git commit`,
      ['-m', `Upload ${github.context.ref} ⎈\n\nDerived from upstream commit${github.context.sha}`],
      { cwd: './output' }
    );
    await exec.exec(`git push`, ['-u', 'origin', `${deployBranch}`], {
      cwd: './output',
    });
    console.log('Finished uploading release.');

    console.log('Enjoy! ✨');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
