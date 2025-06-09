module.exports = {
	"extends": ["@commitlint/config-conventional"],
	"plugins": ["@mridang/commitlint-plugin-conditionals"],
	"rules": {
		"body-max-line-length": [0, "always"],
		"ignore-for-authors": [
			2,
			"always",
			{
				"signOffPatternsToIgnore": ["Your dName"],
				"rulesToEnforce": [
					{
						"packageName": "@commitlint/rules",
						"ruleName": "body-max-line-length",
						"value": 200
					}
				]
			}
		]
	}
}
