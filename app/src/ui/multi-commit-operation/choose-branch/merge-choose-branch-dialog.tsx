import React from 'react'
import { getAheadBehind, revSymmetricDifference } from '../../../lib/git'
import { determineMergeability } from '../../../lib/git/merge-tree'
import { promiseWithMinimumTimeout } from '../../../lib/promise'
import { Branch } from '../../../models/branch'
import { ComputedAction } from '../../../models/computed-action'
import { MergeTreeResult } from '../../../models/merge'
import { MultiCommitOperationKind } from '../../../models/multi-commit-operation'
import { PopupType } from '../../../models/popup'
import { ActionStatusIcon } from '../../lib/action-status-icon'
import { BaseChooseBranchDialog } from './base-choose-branch-dialog'

export class MergeChooseBranchDialog extends BaseChooseBranchDialog {
  private commitCount: number = 0
  private mergeStatus: MergeTreeResult | null = null

  protected start = () => {
    if (!this.canStart()) {
      return
    }

    const { selectedBranch } = this.state
    const { operation, dispatcher, repository } = this.props
    if (!selectedBranch) {
      return
    }

    dispatcher.mergeBranch(
      repository,
      selectedBranch,
      this.mergeStatus,
      operation === MultiCommitOperationKind.Squash
    )
    this.props.dispatcher.closePopup(PopupType.MultiCommitOperation)
  }

  protected canStart = (): boolean => {
    const selectedBranch = this.state.selectedBranch
    const currentBranch = this.props.currentBranch

    const selectedBranchIsCurrentBranch =
      selectedBranch !== null &&
      currentBranch !== null &&
      selectedBranch.name === currentBranch.name

    const isBehind = this.commitCount !== undefined && this.commitCount > 0

    const canMergeBranch =
      this.mergeStatus === null ||
      this.mergeStatus.kind !== ComputedAction.Invalid

    return (
      selectedBranch !== null &&
      !selectedBranchIsCurrentBranch &&
      isBehind &&
      canMergeBranch
    )
  }

  protected onSelectionChanged = async (selectedBranch: Branch | null) => {
    if (selectedBranch != null) {
      this.setState({ selectedBranch })
      return this.updateStatus(selectedBranch)
    }

    // return to empty state
    this.setState({ selectedBranch })
    this.commitCount = 0
    this.mergeStatus = null
  }

  protected renderActionStatusIcon = () => {
    return (
      <ActionStatusIcon
        status={this.mergeStatus}
        classNamePrefix="merge-status"
      />
    )
  }

  protected getDialogTitle = (branchName: string) => {
    const squashPrefix =
      this.props.operation === MultiCommitOperationKind.Squash
        ? 'Squash and '
        : null
    return (
      <>
        {squashPrefix}Merge into <strong>{branchName}</strong>
      </>
    )
  }

  protected updateStatus = async (branch: Branch) => {
    const { currentBranch, repository } = this.props
    this.updateMergeStatusPreview(branch, { kind: ComputedAction.Loading })

    const mergeStatus = await promiseWithMinimumTimeout(
      () => determineMergeability(repository, currentBranch, branch),
      500
    ).catch<MergeTreeResult>(e => {
      log.error('Failed determining mergeability', e)
      return { kind: ComputedAction.Clean }
    })

    // The user has selected a different branch since we started, so don't
    // update the preview with stale data.
    if (this.state.selectedBranch !== branch) {
      return
    }

    // The clean status is the only one that needs the ahead/behind count. If
    // the status is conflicts or invalid, update the UI here and end the
    // function.
    if (
      mergeStatus.kind === ComputedAction.Conflicts ||
      mergeStatus.kind === ComputedAction.Invalid
    ) {
      this.updateMergeStatusPreview(branch, mergeStatus)
      return
    }

    const range = revSymmetricDifference('', branch.name)
    const aheadBehind = await getAheadBehind(this.props.repository, range)
    this.commitCount = aheadBehind ? aheadBehind.behind : 0

    if (this.state.selectedBranch !== branch) {
      this.commitCount = 0
      return
    }

    this.updateMergeStatusPreview(branch, mergeStatus)
  }

  private updateMergeStatusPreview(
    branch: Branch,
    mergeStatus: MergeTreeResult
  ) {
    this.mergeStatus = mergeStatus
    this.setState({ statusPreview: this.getMergeStatusPreview(branch) })
  }

  private getMergeStatusPreview(branch: Branch): JSX.Element | null {
    const { currentBranch } = this.props

    if (this.mergeStatus === null) {
      return null
    }

    if (this.mergeStatus.kind === ComputedAction.Loading) {
      return this.renderLoadingMergeMessage()
    }

    if (this.mergeStatus.kind === ComputedAction.Clean) {
      return this.renderCleanMergeMessage(
        branch,
        currentBranch,
        this.commitCount
      )
    }

    if (this.mergeStatus.kind === ComputedAction.Invalid) {
      return this.renderInvalidMergeMessage()
    }

    return this.renderConflictedMergeMessage(
      branch,
      currentBranch,
      this.mergeStatus.conflictedFiles
    )
  }

  private renderLoadingMergeMessage() {
    return (
      <React.Fragment>
        Checking for ability to merge automatically...
      </React.Fragment>
    )
  }

  private renderCleanMergeMessage(
    branch: Branch,
    currentBranch: Branch,
    commitCount: number
  ) {
    if (commitCount === 0) {
      return (
        <React.Fragment>
          {`This branch is up to date with `}
          <strong>{branch.name}</strong>
        </React.Fragment>
      )
    }

    const pluralized = commitCount === 1 ? 'commit' : 'commits'
    return (
      <React.Fragment>
        This will merge
        <strong>{` ${commitCount} ${pluralized}`}</strong>
        {` from `}
        <strong>{branch.name}</strong>
        {` into `}
        <strong>{currentBranch.name}</strong>
      </React.Fragment>
    )
  }

  private renderInvalidMergeMessage() {
    return (
      <React.Fragment>
        Unable to merge unrelated histories in this repository
      </React.Fragment>
    )
  }

  private renderConflictedMergeMessage(
    branch: Branch,
    currentBranch: Branch,
    count: number
  ) {
    const pluralized = count === 1 ? 'file' : 'files'
    return (
      <React.Fragment>
        There will be
        <strong>{` ${count} conflicted ${pluralized}`}</strong>
        {` when merging `}
        <strong>{branch.name}</strong>
        {` into `}
        <strong>{currentBranch.name}</strong>
      </React.Fragment>
    )
  }
}
