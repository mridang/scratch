const packageJson = require('./package.json');

module.exports = {
	branches: ['beta', { name: 'master', prerelease: 'beta' }],
	plugins: [
		'@semantic-release/commit-analyzer',
		'@semantic-release/release-notes-generator',
		[
			'@semantic-release/github',
			{
				assets: [{ path: '*.tgz', label: 'Package' }],
			},
		],
		[
			'@semantic-release/git',
			{
				assets: ['package.json', 'package-lock.json'],
				message:
					'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
			},
		],
	],
	repositoryUrl: "git+https://github.com/mridang/scratch.git"
};
