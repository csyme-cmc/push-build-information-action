import { isDebug } from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { Commit, PushEvent } from '@octokit/webhooks-types/schema'
import {
  BuildInformationRepository,
  Client,
  CreateOctopusBuildInformationCommand,
  IOctopusBuildInformationCommit,
  PackageIdentity
} from '@octopusdeploy/api-client'
import { InputParameters } from './input-parameters'

export async function pushBuildInformationFromInputs(
  client: Client,
  runId: number,
  parameters: InputParameters
): Promise<void> {
  // get the branch name
  let branch: string = parameters.branch || context.ref
  if (branch.startsWith('refs/heads/')) {
    branch = branch.substring('refs/heads/'.length)
  }

  const repoUri = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`
  const pushEvent = context.payload as PushEvent | undefined

  const lastPushEventOnly = parameters.lastPushEventOnly || true
  let commits: IOctopusBuildInformationCommit[]

  if (lastPushEventOnly) {
    // If lastPushEventOnly is true, retrieve commits from the last push event
    commits =
      pushEvent?.commits?.map((commit: Commit) => {
        return {
          Id: commit.id,
          Comment: commit.message
        }
      }) || []
  } else {
    const baseBranch: string = parameters.baseBranch || 'master'
    const githubToken = parameters.githubToken
    const octokit = getOctokit(githubToken)

    // Get the list of commits between the two branches
    const result = await octokit.rest.repos.compareCommits({
      repo: context.repo.repo,
      owner: context.repo.owner,
      head: branch,
      base: baseBranch,
      per_page: 100
    })

    commits =
      result.data.commits.map(commit => ({
        Id: commit.sha,
        Comment: commit.commit.message
      })) || []
  }

  const packages: PackageIdentity[] = []
  for (const packageId of parameters.packages) {
    packages.push({
      Id: packageId,
      Version: parameters.version
    })
  }

  const command: CreateOctopusBuildInformationCommand = {
    spaceName: parameters.space,
    BuildEnvironment: 'GitHub Actions',
    BuildNumber: context.runNumber.toString(),
    BuildUrl: `${repoUri}/actions/runs/${runId}`,
    Branch: branch,
    VcsType: 'Git',
    VcsRoot: `${repoUri}`,
    VcsCommitNumber: context.sha,
    Commits: commits,
    Packages: packages
  }

  if (isDebug()) {
    client.info(`Build Information:\n${JSON.stringify(command, null, 2)}`)
  }

  const repository = new BuildInformationRepository(client, parameters.space)
  await repository.push(command, parameters.overwriteMode)

  client.info('Successfully pushed build information to Octopus')
}
