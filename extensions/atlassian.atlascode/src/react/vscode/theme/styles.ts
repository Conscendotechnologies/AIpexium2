import { createContext } from 'react';

export interface VSCodeStyles {
    activityBarBackground: string;
    activityBarDropBackground: string;
    activityBarForeground: string;
    activityBarInactiveForeground: string;
    activityBarBadgeBackground: string;
    activityBarBadgeForeground: string;
    badgeBackground: string;
    badgeForeground: string;
    breadcrumbActiveSelectionForeground: string;
    breadcrumbBackground: string;
    breadcrumbFocusForeground: string;
    breadcrumbForeground: string;
    breadcrumbPickerBackground: string;
    buttonBackground: string;
    buttonForeground: string;
    buttonHoverBackground: string;
    debugExceptionWidgetBackground: string;
    debugExceptionWidgetBorder: string;
    debugToolBarBackground: string;
    descriptionForeground: string;
    diffEditorInsertedTextBackground: string;
    diffEditorRemovedTextBackground: string;
    dropdownBackground: string;
    dropdownBorder: string;
    editorBackground: string;
    editorFindMatchBackground: string;
    editorFindMatchHighlightBackground: string;
    editorFindRangeHighlightBackground: string;
    editorFocusedStackFrameHighlightBackground: string;
    editorFontFamily: string;
    editorFontSize: number;
    editorFontWeight: string;
    editorForeground: string;
    editorHoverHighlightBackground: string;
    editorInactiveSelectionBackground: string;
    editorLineHighlightBorder: string;
    editorRangeHighlightBackground: string;
    editorSelectionBackground: string;
    editorSelectionHighlightBackground: string;
    editorSnippetFinalTabstopHighlightBorder: string;
    editorSnippetTabstopHighlightBackground: string;
    editorStackFrameHighlightBackground: string;
    editorWordHighlightBackground: string;
    editorWordHighlightStrongBackground: string;
    editorActiveLineNumberForeground: string;
    editorBracketMatchBackground: string;
    editorBracketMatchBorder: string;
    editorCodeLensForeground: string;
    editorCursorForeground: string;
    editorErrorForeground: string;
    editorGroupBorder: string;
    editorGroupDropBackground: string;
    editorGroupHeaderNoTabsBackground: string;
    editorGroupHeaderTabsBackground: string;
    editorGutterAddedBackground: string;
    editorGutterBackground: string;
    editorGutterCommentRangeForeground: string;
    editorGutterDeletedBackground: string;
    editorGutterModifiedBackground: string;
    editorHintForeground: string;
    editorHoverWidgetBackground: string;
    editorHoverWidgetBorder: string;
    editorHoverWidgetStatusBarBackground: string;
    editorIndentGuideActiveBackground: string;
    editorIndentGuideBackground: string;
    editorInfoForeground: string;
    editorLineNumberActiveForeground: string;
    editorLineNumberForeground: string;
    editorLinkActiveForeground: string;
    editorMarkerNavigationBackground: string;
    editorMarkerNavigationErrorBackground: string;
    editorMarkerNavigationInfoBackground: string;
    editorMarkerNavigationWarningBackground: string;
    editorOverviewRulerAddedForeground: string;
    editorOverviewRulerBorder: string;
    editorOverviewRulerBracketMatchForeground: string;
    editorOverviewRulerCommonContentForeground: string;
    editorOverviewRulerCurrentContentForeground: string;
    editorOverviewRulerDeletedForeground: string;
    editorOverviewRulerErrorForeground: string;
    editorOverviewRulerFindMatchForeground: string;
    editorOverviewRulerIncomingContentForeground: string;
    editorOverviewRulerInfoForeground: string;
    editorOverviewRulerModifiedForeground: string;
    editorOverviewRulerRangeHighlightForeground: string;
    editorOverviewRulerSelectionHighlightForeground: string;
    editorOverviewRulerWarningForeground: string;
    editorOverviewRulerWordHighlightForeground: string;
    editorOverviewRulerWordHighlightStrongForeground: string;
    editorPaneBackground: string;
    editorRulerForeground: string;
    editorSuggestWidgetBackground: string;
    editorSuggestWidgetBorder: string;
    editorSuggestWidgetForeground: string;
    editorSuggestWidgetHighlightForeground: string;
    editorSuggestWidgetSelectedBackground: string;
    editorUnnecessaryCodeOpacity: string;
    editorWarningForeground: string;
    editorWhitespaceForeground: string;
    editorWidgetBackground: string;
    editorWidgetBorder: string;
    errorForeground: string;
    extensionBadgeRemoteBackground: string;
    extensionBadgeRemoteForeground: string;
    extensionButtonProminentBackground: string;
    extensionButtonProminentForeground: string;
    extensionButtonProminentHoverBackground: string;
    focusBorder: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    foreground: string;
    gitDecorationAddedResourceForeground: string;
    gitDecorationConflictingResourceForeground: string;
    gitDecorationDeletedResourceForeground: string;
    gitDecorationIgnoredResourceForeground: string;
    gitDecorationModifiedResourceForeground: string;
    gitDecorationSubmoduleResourceForeground: string;
    gitDecorationUntrackedResourceForeground: string;
    gitlensGutterBackgroundColor: string;
    gitlensGutterForegroundColor: string;
    gitlensGutterUncommittedForegroundColor: string;
    gitlensLineHighlightBackgroundColor: string;
    gitlensLineHighlightOverviewRulerColor: string;
    gitlensTrailingLineBackgroundColor: string;
    gitlensTrailingLineForegroundColor: string;
    inputBackground: string;
    inputForeground: string;
    inputPlaceholderForeground: string;
    inputOptionActiveBorder: string;
    inputValidationErrorBackground: string;
    inputValidationErrorBorder: string;
    inputValidationInfoBackground: string;
    inputValidationInfoBorder: string;
    inputValidationWarningBackground: string;
    inputValidationWarningBorder: string;
    listActiveSelectionBackground: string;
    listActiveSelectionForeground: string;
    listDropBackground: string;
    listErrorForeground: string;
    listFocusBackground: string;
    listHighlightForeground: string;
    listHoverBackground: string;
    listInactiveSelectionBackground: string;
    listInvalidItemForeground: string;
    listWarningForeground: string;
    listFilterWidgetBackground: string;
    listFilterWidgetNoMatchesOutline: string;
    listFilterWidgetOutline: string;
    menuBackground: string;
    menuForeground: string;
    menuSelectionBackground: string;
    menuSelectionForeground: string;
    menuSeparatorBackground: string;
    menubarSelectionBackground: string;
    menubarSelectionForeground: string;
    mergeCommonContentBackground: string;
    mergeCommonHeaderBackground: string;
    mergeCurrentContentBackground: string;
    mergeCurrentHeaderBackground: string;
    mergeIncomingContentBackground: string;
    mergeIncomingHeaderBackground: string;
    notificationCenterHeaderBackground: string;
    notificationLinkForeground: string;
    notificationsBackground: string;
    notificationsBorder: string;
    panelBackground: string;
    panelBorder: string;
    panelDropBackground: string;
    panelInputBorder: string;
    panelTitleActiveBorder: string;
    panelTitleActiveForeground: string;
    panelTitleInactiveForeground: string;
    peekViewBorder: string;
    peekViewEditorBackground: string;
    peekViewEditorMatchHighlightBackground: string;
    peekViewEditorGutterBackground: string;
    peekViewResultBackground: string;
    peekViewResultFileForeground: string;
    peekViewResultLineForeground: string;
    peekViewResultMatchHighlightBackground: string;
    peekViewResultSelectionBackground: string;
    peekViewResultSelectionForeground: string;
    peekViewTitleBackground: string;
    peekViewTitleDescriptionForeground: string;
    peekViewTitleLabelForeground: string;
    pickerGroupBorder: string;
    pickerGroupForeground: string;
    progressBarBackground: string;
    quickInputBackground: string;
    scrollbarShadow: string;
    scrollbarSliderActiveBackground: string;
    scrollbarSliderBackground: string;
    scrollbarSliderHoverBackground: string;
    settingsCheckboxBackground: string;
    settingsCheckboxBorder: string;
    settingsDropdownBackground: string;
    settingsDropdownBorder: string;
    settingsDropdownListBorder: string;
    settingsHeaderForeground: string;
    settingsModifiedItemIndicator: string;
    settingsNumberInputBackground: string;
    settingsNumberInputBorder: string;
    settingsNumberInputForeground: string;
    settingsTextInputBackground: string;
    settingsTextInputBorder: string;
    settingsTextInputForeground: string;
    sideBarBackground: string;
    sideBarDropBackground: string;
    sideBarSectionHeaderBackground: string;
    sideBarTitleForeground: string;
    statusBarBackground: string;
    statusBarDebuggingBackground: string;
    statusBarDebuggingForeground: string;
    statusBarForeground: string;
    statusBarNoFolderBackground: string;
    statusBarNoFolderForeground: string;
    statusBarItemActiveBackground: string;
    statusBarItemHoverBackground: string;
    statusBarItemProminentBackground: string;
    statusBarItemProminentForeground: string;
    statusBarItemProminentHoverBackground: string;
    statusBarItemRemoteBackground: string;
    statusBarItemRemoteForeground: string;
    tabActiveBackground: string;
    tabActiveForeground: string;
    tabActiveModifiedBorder: string;
    tabBorder: string;
    tabInactiveBackground: string;
    tabInactiveForeground: string;
    tabInactiveModifiedBorder: string;
    tabUnfocusedActiveBackground: string;
    tabUnfocusedActiveForeground: string;
    tabUnfocusedActiveModifiedBorder: string;
    tabUnfocusedInactiveForeground: string;
    tabUnfocusedInactiveModifiedBorder: string;
    terminalAnsiBlack: string;
    terminalAnsiBlue: string;
    terminalAnsiBrightBlack: string;
    terminalAnsiBrightBlue: string;
    terminalAnsiBrightCyan: string;
    terminalAnsiBrightGreen: string;
    terminalAnsiBrightMagenta: string;
    terminalAnsiBrightRed: string;
    terminalAnsiBrightWhite: string;
    terminalAnsiBrightYellow: string;
    terminalAnsiCyan: string;
    terminalAnsiGreen: string;
    terminalAnsiMagenta: string;
    terminalAnsiRed: string;
    terminalAnsiWhite: string;
    terminalAnsiYellow: string;
    terminalBackground: string;
    terminalBorder: string;
    terminalForeground: string;
    terminalSelectionBackground: string;
    textBlockQuoteBackground: string;
    textBlockQuoteBorder: string;
    textCodeBlockBackground: string;
    textLinkActiveForeground: string;
    textLinkForeground: string;
    textPreformatForeground: string;
    textSeparatorForeground: string;
    titleBarActiveBackground: string;
    titleBarActiveForeground: string;
    titleBarInactiveBackground: string;
    titleBarInactiveForeground: string;
    treeIndentGuidesStroke: string;
    widgetShadow: string;
    editorLineHighlightBackground: string;
    selectionBackground: string;
    walkThroughEmbeddedEditorBackground: string;
    dropdownForeground: string;
    settingsCheckboxForeground: string;
    settingsDropdownForeground: string;
}

const emptyStyles: VSCodeStyles = {
    activityBarBackground: '',
    activityBarDropBackground: '',
    activityBarForeground: '',
    activityBarInactiveForeground: '',
    activityBarBadgeBackground: '',
    activityBarBadgeForeground: '',
    badgeBackground: '',
    badgeForeground: '',
    breadcrumbActiveSelectionForeground: '',
    breadcrumbBackground: '',
    breadcrumbFocusForeground: '',
    breadcrumbForeground: '',
    breadcrumbPickerBackground: '',
    buttonBackground: '',
    buttonForeground: '',
    buttonHoverBackground: '',
    debugExceptionWidgetBackground: '',
    debugExceptionWidgetBorder: '',
    debugToolBarBackground: '',
    descriptionForeground: '',
    diffEditorInsertedTextBackground: '',
    diffEditorRemovedTextBackground: '',
    dropdownBackground: '',
    dropdownBorder: '',
    editorBackground: '',
    editorFindMatchBackground: '',
    editorFindMatchHighlightBackground: '',
    editorFindRangeHighlightBackground: '',
    editorFocusedStackFrameHighlightBackground: '',
    editorFontFamily: '',
    editorFontSize: 12,
    editorFontWeight: '',
    editorForeground: '',
    editorHoverHighlightBackground: '',
    editorInactiveSelectionBackground: '',
    editorLineHighlightBorder: '',
    editorRangeHighlightBackground: '',
    editorSelectionBackground: '',
    editorSelectionHighlightBackground: '',
    editorSnippetFinalTabstopHighlightBorder: '',
    editorSnippetTabstopHighlightBackground: '',
    editorStackFrameHighlightBackground: '',
    editorWordHighlightBackground: '',
    editorWordHighlightStrongBackground: '',
    editorActiveLineNumberForeground: '',
    editorBracketMatchBackground: '',
    editorBracketMatchBorder: '',
    editorCodeLensForeground: '',
    editorCursorForeground: '',
    editorErrorForeground: '',
    editorGroupBorder: '',
    editorGroupDropBackground: '',
    editorGroupHeaderNoTabsBackground: '',
    editorGroupHeaderTabsBackground: '',
    editorGutterAddedBackground: '',
    editorGutterBackground: '',
    editorGutterCommentRangeForeground: '',
    editorGutterDeletedBackground: '',
    editorGutterModifiedBackground: '',
    editorHintForeground: '',
    editorHoverWidgetBackground: '',
    editorHoverWidgetBorder: '',
    editorHoverWidgetStatusBarBackground: '',
    editorIndentGuideActiveBackground: '',
    editorIndentGuideBackground: '',
    editorInfoForeground: '',
    editorLineNumberActiveForeground: '',
    editorLineNumberForeground: '',
    editorLinkActiveForeground: '',
    editorMarkerNavigationBackground: '',
    editorMarkerNavigationErrorBackground: '',
    editorMarkerNavigationInfoBackground: '',
    editorMarkerNavigationWarningBackground: '',
    editorOverviewRulerAddedForeground: '',
    editorOverviewRulerBorder: '',
    editorOverviewRulerBracketMatchForeground: '',
    editorOverviewRulerCommonContentForeground: '',
    editorOverviewRulerCurrentContentForeground: '',
    editorOverviewRulerDeletedForeground: '',
    editorOverviewRulerErrorForeground: '',
    editorOverviewRulerFindMatchForeground: '',
    editorOverviewRulerIncomingContentForeground: '',
    editorOverviewRulerInfoForeground: '',
    editorOverviewRulerModifiedForeground: '',
    editorOverviewRulerRangeHighlightForeground: '',
    editorOverviewRulerSelectionHighlightForeground: '',
    editorOverviewRulerWarningForeground: '',
    editorOverviewRulerWordHighlightForeground: '',
    editorOverviewRulerWordHighlightStrongForeground: '',
    editorPaneBackground: '',
    editorRulerForeground: '',
    editorSuggestWidgetBackground: '',
    editorSuggestWidgetBorder: '',
    editorSuggestWidgetForeground: '',
    editorSuggestWidgetHighlightForeground: '',
    editorSuggestWidgetSelectedBackground: '',
    editorUnnecessaryCodeOpacity: '',
    editorWarningForeground: '',
    editorWhitespaceForeground: '',
    editorWidgetBackground: '',
    editorWidgetBorder: '',
    errorForeground: '',
    extensionBadgeRemoteBackground: '',
    extensionBadgeRemoteForeground: '',
    extensionButtonProminentBackground: '',
    extensionButtonProminentForeground: '',
    extensionButtonProminentHoverBackground: '',
    focusBorder: '',
    fontFamily: '',
    fontSize: 12,
    fontWeight: '',
    foreground: '',
    gitDecorationAddedResourceForeground: '',
    gitDecorationConflictingResourceForeground: '',
    gitDecorationDeletedResourceForeground: '',
    gitDecorationIgnoredResourceForeground: '',
    gitDecorationModifiedResourceForeground: '',
    gitDecorationSubmoduleResourceForeground: '',
    gitDecorationUntrackedResourceForeground: '',
    gitlensGutterBackgroundColor: '',
    gitlensGutterForegroundColor: '',
    gitlensGutterUncommittedForegroundColor: '',
    gitlensLineHighlightBackgroundColor: '',
    gitlensLineHighlightOverviewRulerColor: '',
    gitlensTrailingLineBackgroundColor: '',
    gitlensTrailingLineForegroundColor: '',
    inputBackground: '',
    inputForeground: '',
    inputPlaceholderForeground: '',
    inputOptionActiveBorder: '',
    inputValidationErrorBackground: '',
    inputValidationErrorBorder: '',
    inputValidationInfoBackground: '',
    inputValidationInfoBorder: '',
    inputValidationWarningBackground: '',
    inputValidationWarningBorder: '',
    listActiveSelectionBackground: '',
    listActiveSelectionForeground: '',
    listDropBackground: '',
    listErrorForeground: '',
    listFocusBackground: '',
    listHighlightForeground: '',
    listHoverBackground: '',
    listInactiveSelectionBackground: '',
    listInvalidItemForeground: '',
    listWarningForeground: '',
    listFilterWidgetBackground: '',
    listFilterWidgetNoMatchesOutline: '',
    listFilterWidgetOutline: '',
    menuBackground: '',
    menuForeground: '',
    menuSelectionBackground: '',
    menuSelectionForeground: '',
    menuSeparatorBackground: '',
    menubarSelectionBackground: '',
    menubarSelectionForeground: '',
    mergeCommonContentBackground: '',
    mergeCommonHeaderBackground: '',
    mergeCurrentContentBackground: '',
    mergeCurrentHeaderBackground: '',
    mergeIncomingContentBackground: '',
    mergeIncomingHeaderBackground: '',
    notificationCenterHeaderBackground: '',
    notificationLinkForeground: '',
    notificationsBackground: '',
    notificationsBorder: '',
    panelBackground: '',
    panelBorder: '',
    panelDropBackground: '',
    panelInputBorder: '',
    panelTitleActiveBorder: '',
    panelTitleActiveForeground: '',
    panelTitleInactiveForeground: '',
    peekViewBorder: '',
    peekViewEditorBackground: '',
    peekViewEditorMatchHighlightBackground: '',
    peekViewEditorGutterBackground: '',
    peekViewResultBackground: '',
    peekViewResultFileForeground: '',
    peekViewResultLineForeground: '',
    peekViewResultMatchHighlightBackground: '',
    peekViewResultSelectionBackground: '',
    peekViewResultSelectionForeground: '',
    peekViewTitleBackground: '',
    peekViewTitleDescriptionForeground: '',
    peekViewTitleLabelForeground: '',
    pickerGroupBorder: '',
    pickerGroupForeground: '',
    progressBarBackground: '',
    quickInputBackground: '',
    scrollbarShadow: '',
    scrollbarSliderActiveBackground: '',
    scrollbarSliderBackground: '',
    scrollbarSliderHoverBackground: '',
    settingsCheckboxBackground: '',
    settingsCheckboxBorder: '',
    settingsDropdownBackground: '',
    settingsDropdownBorder: '',
    settingsDropdownListBorder: '',
    settingsHeaderForeground: '',
    settingsModifiedItemIndicator: '',
    settingsNumberInputBackground: '',
    settingsNumberInputBorder: '',
    settingsNumberInputForeground: '',
    settingsTextInputBackground: '',
    settingsTextInputBorder: '',
    settingsTextInputForeground: '',
    sideBarBackground: '',
    sideBarDropBackground: '',
    sideBarSectionHeaderBackground: '',
    sideBarTitleForeground: '',
    statusBarBackground: '',
    statusBarDebuggingBackground: '',
    statusBarDebuggingForeground: '',
    statusBarForeground: '',
    statusBarNoFolderBackground: '',
    statusBarNoFolderForeground: '',
    statusBarItemActiveBackground: '',
    statusBarItemHoverBackground: '',
    statusBarItemProminentBackground: '',
    statusBarItemProminentForeground: '',
    statusBarItemProminentHoverBackground: '',
    statusBarItemRemoteBackground: '',
    statusBarItemRemoteForeground: '',
    tabActiveBackground: '',
    tabActiveForeground: '',
    tabActiveModifiedBorder: '',
    tabBorder: '',
    tabInactiveBackground: '',
    tabInactiveForeground: '',
    tabInactiveModifiedBorder: '',
    tabUnfocusedActiveBackground: '',
    tabUnfocusedActiveForeground: '',
    tabUnfocusedActiveModifiedBorder: '',
    tabUnfocusedInactiveForeground: '',
    tabUnfocusedInactiveModifiedBorder: '',
    terminalAnsiBlack: '',
    terminalAnsiBlue: '',
    terminalAnsiBrightBlack: '',
    terminalAnsiBrightBlue: '',
    terminalAnsiBrightCyan: '',
    terminalAnsiBrightGreen: '',
    terminalAnsiBrightMagenta: '',
    terminalAnsiBrightRed: '',
    terminalAnsiBrightWhite: '',
    terminalAnsiBrightYellow: '',
    terminalAnsiCyan: '',
    terminalAnsiGreen: '',
    terminalAnsiMagenta: '',
    terminalAnsiRed: '',
    terminalAnsiWhite: '',
    terminalAnsiYellow: '',
    terminalBackground: '',
    terminalBorder: '',
    terminalForeground: '',
    terminalSelectionBackground: '',
    textBlockQuoteBackground: '',
    textBlockQuoteBorder: '',
    textCodeBlockBackground: '',
    textLinkActiveForeground: '',
    textLinkForeground: '',
    textPreformatForeground: '',
    textSeparatorForeground: '',
    titleBarActiveBackground: '',
    titleBarActiveForeground: '',
    titleBarInactiveBackground: '',
    titleBarInactiveForeground: '',
    treeIndentGuidesStroke: '',
    widgetShadow: '',
    editorLineHighlightBackground: '',
    selectionBackground: '',
    walkThroughEmbeddedEditorBackground: '',
    dropdownForeground: '',
    settingsCheckboxForeground: '',
    settingsDropdownForeground: '',
};
export const VSCodeStylesContext = createContext<VSCodeStyles>(emptyStyles);
export const computeStyles = (): VSCodeStyles => {
    const body = document.body;

    const computedStyle = getComputedStyle(body);
    return {
        activityBarBackground: computedStyle.getPropertyValue('--vscode-activityBar-background').trim(),
        activityBarDropBackground: computedStyle.getPropertyValue('--vscode-activityBar-dropBackground').trim(),
        activityBarForeground: computedStyle.getPropertyValue('--vscode-activityBar-foreground').trim(),
        activityBarInactiveForeground: computedStyle.getPropertyValue('--vscode-activityBar-inactiveForeground').trim(),
        activityBarBadgeBackground: computedStyle.getPropertyValue('--vscode-activityBarBadge-background').trim(),
        activityBarBadgeForeground: computedStyle.getPropertyValue('--vscode-activityBarBadge-foreground').trim(),
        badgeBackground: computedStyle.getPropertyValue('--vscode-badge-background').trim(),
        badgeForeground: computedStyle.getPropertyValue('--vscode-badge-foreground').trim(),
        breadcrumbActiveSelectionForeground: computedStyle
            .getPropertyValue('--vscode-breadcrumb-activeSelectionForeground')
            .trim(),
        breadcrumbBackground: computedStyle.getPropertyValue('--vscode-breadcrumb-background').trim(),
        breadcrumbFocusForeground: computedStyle.getPropertyValue('--vscode-breadcrumb-focusForeground').trim(),
        breadcrumbForeground: computedStyle.getPropertyValue('--vscode-breadcrumb-foreground').trim(),
        breadcrumbPickerBackground: computedStyle.getPropertyValue('--vscode-breadcrumbPicker-background').trim(),
        buttonBackground: computedStyle.getPropertyValue('--vscode-button-background').trim(),
        buttonForeground: computedStyle.getPropertyValue('--vscode-button-foreground').trim(),
        buttonHoverBackground: computedStyle.getPropertyValue('--vscode-button-hoverBackground').trim(),
        debugExceptionWidgetBackground: computedStyle
            .getPropertyValue('--vscode-debugExceptionWidget-background')
            .trim(),
        debugExceptionWidgetBorder: computedStyle.getPropertyValue('--vscode-debugExceptionWidget-border').trim(),
        debugToolBarBackground: computedStyle.getPropertyValue('--vscode-debugToolBar-background').trim(),
        descriptionForeground: computedStyle.getPropertyValue('--vscode-descriptionForeground').trim(),
        diffEditorInsertedTextBackground: computedStyle
            .getPropertyValue('--vscode-diffEditor-insertedTextBackground')
            .trim(),
        diffEditorRemovedTextBackground: computedStyle
            .getPropertyValue('--vscode-diffEditor-removedTextBackground')
            .trim(),
        dropdownBackground: computedStyle.getPropertyValue('--vscode-dropdown-background').trim(),
        dropdownBorder: computedStyle.getPropertyValue('--vscode-dropdown-border').trim(),
        editorBackground: computedStyle.getPropertyValue('--vscode-editor-background').trim(),
        editorFindMatchBackground: computedStyle.getPropertyValue('--vscode-editor-findMatchBackground').trim(),
        editorFindMatchHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-findMatchHighlightBackground')
            .trim(),
        editorFindRangeHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-findRangeHighlightBackground')
            .trim(),
        editorFocusedStackFrameHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-focusedStackFrameHighlightBackground')
            .trim(),
        editorFontFamily: computedStyle.getPropertyValue('--vscode-editor-font-family').trim(),
        editorFontSize: parseInt(computedStyle.getPropertyValue('--vscode-editor-font-size').trim()),
        editorFontWeight: computedStyle.getPropertyValue('--vscode-editor-font-weight').trim(),
        editorForeground: computedStyle.getPropertyValue('--vscode-editor-foreground').trim(),
        editorHoverHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-hoverHighlightBackground')
            .trim(),
        editorInactiveSelectionBackground: computedStyle
            .getPropertyValue('--vscode-editor-inactiveSelectionBackground')
            .trim(),
        editorLineHighlightBorder: computedStyle.getPropertyValue('--vscode-editor-lineHighlightBorder').trim(),
        editorRangeHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-rangeHighlightBackground')
            .trim(),
        editorSelectionBackground: computedStyle.getPropertyValue('--vscode-editor-selectionBackground').trim(),
        editorSelectionHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-selectionHighlightBackground')
            .trim(),
        editorSnippetFinalTabstopHighlightBorder: computedStyle
            .getPropertyValue('--vscode-editor-snippetFinalTabstopHighlightBorder')
            .trim(),
        editorSnippetTabstopHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-snippetTabstopHighlightBackground')
            .trim(),
        editorStackFrameHighlightBackground: computedStyle
            .getPropertyValue('--vscode-editor-stackFrameHighlightBackground')
            .trim(),
        editorWordHighlightBackground: computedStyle.getPropertyValue('--vscode-editor-wordHighlightBackground').trim(),
        editorWordHighlightStrongBackground: computedStyle
            .getPropertyValue('--vscode-editor-wordHighlightStrongBackground')
            .trim(),
        editorActiveLineNumberForeground: computedStyle
            .getPropertyValue('--vscode-editorActiveLineNumber-foreground')
            .trim(),
        editorBracketMatchBackground: computedStyle.getPropertyValue('--vscode-editorBracketMatch-background').trim(),
        editorBracketMatchBorder: computedStyle.getPropertyValue('--vscode-editorBracketMatch-border').trim(),
        editorCodeLensForeground: computedStyle.getPropertyValue('--vscode-editorCodeLens-foreground').trim(),
        editorCursorForeground: computedStyle.getPropertyValue('--vscode-editorCursor-foreground').trim(),
        editorErrorForeground: computedStyle.getPropertyValue('--vscode-editorError-foreground').trim(),
        editorGroupBorder: computedStyle.getPropertyValue('--vscode-editorGroup-border').trim(),
        editorGroupDropBackground: computedStyle.getPropertyValue('--vscode-editorGroup-dropBackground').trim(),
        editorGroupHeaderNoTabsBackground: computedStyle
            .getPropertyValue('--vscode-editorGroupHeader-noTabsBackground')
            .trim(),
        editorGroupHeaderTabsBackground: computedStyle
            .getPropertyValue('--vscode-editorGroupHeader-tabsBackground')
            .trim(),
        editorGutterAddedBackground: computedStyle.getPropertyValue('--vscode-editorGutter-addedBackground').trim(),
        editorGutterBackground: computedStyle.getPropertyValue('--vscode-editorGutter-background').trim(),
        editorGutterCommentRangeForeground: computedStyle
            .getPropertyValue('--vscode-editorGutter-commentRangeForeground')
            .trim(),
        editorGutterDeletedBackground: computedStyle.getPropertyValue('--vscode-editorGutter-deletedBackground').trim(),
        editorGutterModifiedBackground: computedStyle
            .getPropertyValue('--vscode-editorGutter-modifiedBackground')
            .trim(),
        editorHintForeground: computedStyle.getPropertyValue('--vscode-editorHint-foreground').trim(),
        editorHoverWidgetBackground: computedStyle.getPropertyValue('--vscode-editorHoverWidget-background').trim(),
        editorHoverWidgetBorder: computedStyle.getPropertyValue('--vscode-editorHoverWidget-border').trim(),
        editorHoverWidgetStatusBarBackground: computedStyle
            .getPropertyValue('--vscode-editorHoverWidget-statusBarBackground')
            .trim(),
        editorIndentGuideActiveBackground: computedStyle
            .getPropertyValue('--vscode-editorIndentGuide-activeBackground')
            .trim(),
        editorIndentGuideBackground: computedStyle.getPropertyValue('--vscode-editorIndentGuide-background').trim(),
        editorInfoForeground: computedStyle.getPropertyValue('--vscode-editorInfo-foreground').trim(),
        editorLineNumberActiveForeground: computedStyle
            .getPropertyValue('--vscode-editorLineNumber-activeForeground')
            .trim(),
        editorLineNumberForeground: computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim(),
        editorLinkActiveForeground: computedStyle.getPropertyValue('--vscode-editorLink-activeForeground').trim(),
        editorMarkerNavigationBackground: computedStyle
            .getPropertyValue('--vscode-editorMarkerNavigation-background')
            .trim(),
        editorMarkerNavigationErrorBackground: computedStyle
            .getPropertyValue('--vscode-editorMarkerNavigationError-background')
            .trim(),
        editorMarkerNavigationInfoBackground: computedStyle
            .getPropertyValue('--vscode-editorMarkerNavigationInfo-background')
            .trim(),
        editorMarkerNavigationWarningBackground: computedStyle
            .getPropertyValue('--vscode-editorMarkerNavigationWarning-background')
            .trim(),
        editorOverviewRulerAddedForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-addedForeground')
            .trim(),
        editorOverviewRulerBorder: computedStyle.getPropertyValue('--vscode-editorOverviewRuler-border').trim(),
        editorOverviewRulerBracketMatchForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-bracketMatchForeground')
            .trim(),
        editorOverviewRulerCommonContentForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-commonContentForeground')
            .trim(),
        editorOverviewRulerCurrentContentForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-currentContentForeground')
            .trim(),
        editorOverviewRulerDeletedForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-deletedForeground')
            .trim(),
        editorOverviewRulerErrorForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-errorForeground')
            .trim(),
        editorOverviewRulerFindMatchForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-findMatchForeground')
            .trim(),
        editorOverviewRulerIncomingContentForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-incomingContentForeground')
            .trim(),
        editorOverviewRulerInfoForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-infoForeground')
            .trim(),
        editorOverviewRulerModifiedForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-modifiedForeground')
            .trim(),
        editorOverviewRulerRangeHighlightForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-rangeHighlightForeground')
            .trim(),
        editorOverviewRulerSelectionHighlightForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-selectionHighlightForeground')
            .trim(),
        editorOverviewRulerWarningForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-warningForeground')
            .trim(),
        editorOverviewRulerWordHighlightForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-wordHighlightForeground')
            .trim(),
        editorOverviewRulerWordHighlightStrongForeground: computedStyle
            .getPropertyValue('--vscode-editorOverviewRuler-wordHighlightStrongForeground')
            .trim(),
        editorPaneBackground: computedStyle.getPropertyValue('--vscode-editorPane-background').trim(),
        editorRulerForeground: computedStyle.getPropertyValue('--vscode-editorRuler-foreground').trim(),
        editorSuggestWidgetBackground: computedStyle.getPropertyValue('--vscode-editorSuggestWidget-background').trim(),
        editorSuggestWidgetBorder: computedStyle.getPropertyValue('--vscode-editorSuggestWidget-border').trim(),
        editorSuggestWidgetForeground: computedStyle.getPropertyValue('--vscode-editorSuggestWidget-foreground').trim(),
        editorSuggestWidgetHighlightForeground: computedStyle
            .getPropertyValue('--vscode-editorSuggestWidget-highlightForeground')
            .trim(),
        editorSuggestWidgetSelectedBackground: computedStyle
            .getPropertyValue('--vscode-editorSuggestWidget-selectedBackground')
            .trim(),
        editorUnnecessaryCodeOpacity: computedStyle.getPropertyValue('--vscode-editorUnnecessaryCode-opacity').trim(),
        editorWarningForeground: computedStyle.getPropertyValue('--vscode-editorWarning-foreground').trim(),
        editorWhitespaceForeground: computedStyle.getPropertyValue('--vscode-editorWhitespace-foreground').trim(),
        editorWidgetBackground: computedStyle.getPropertyValue('--vscode-editorWidget-background').trim(),
        editorWidgetBorder: computedStyle.getPropertyValue('--vscode-editorWidget-border').trim(),
        errorForeground: computedStyle.getPropertyValue('--vscode-errorForeground').trim(),
        extensionBadgeRemoteBackground: computedStyle
            .getPropertyValue('--vscode-extensionBadge-remoteBackground')
            .trim(),
        extensionBadgeRemoteForeground: computedStyle
            .getPropertyValue('--vscode-extensionBadge-remoteForeground')
            .trim(),
        extensionButtonProminentBackground: computedStyle
            .getPropertyValue('--vscode-extensionButton-prominentBackground')
            .trim(),
        extensionButtonProminentForeground: computedStyle
            .getPropertyValue('--vscode-extensionButton-prominentForeground')
            .trim(),
        extensionButtonProminentHoverBackground: computedStyle
            .getPropertyValue('--vscode-extensionButton-prominentHoverBackground')
            .trim(),
        focusBorder: computedStyle.getPropertyValue('--vscode-focusBorder').trim(),
        fontFamily: computedStyle.getPropertyValue('--vscode-font-family').trim(),
        fontSize: parseInt(computedStyle.getPropertyValue('--vscode-editor-font-size').trim()),
        fontWeight: computedStyle.getPropertyValue('--vscode-font-weight').trim(),
        foreground: computedStyle.getPropertyValue('--vscode-foreground').trim(),
        gitDecorationAddedResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-addedResourceForeground')
            .trim(),
        gitDecorationConflictingResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-conflictingResourceForeground')
            .trim(),
        gitDecorationDeletedResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-deletedResourceForeground')
            .trim(),
        gitDecorationIgnoredResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-ignoredResourceForeground')
            .trim(),
        gitDecorationModifiedResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground')
            .trim(),
        gitDecorationSubmoduleResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-submoduleResourceForeground')
            .trim(),
        gitDecorationUntrackedResourceForeground: computedStyle
            .getPropertyValue('--vscode-gitDecoration-untrackedResourceForeground')
            .trim(),
        gitlensGutterBackgroundColor: computedStyle.getPropertyValue('--vscode-gitlens-gutterBackgroundColor').trim(),
        gitlensGutterForegroundColor: computedStyle.getPropertyValue('--vscode-gitlens-gutterForegroundColor').trim(),
        gitlensGutterUncommittedForegroundColor: computedStyle
            .getPropertyValue('--vscode-gitlens-gutterUncommittedForegroundColor')
            .trim(),
        gitlensLineHighlightBackgroundColor: computedStyle
            .getPropertyValue('--vscode-gitlens-lineHighlightBackgroundColor')
            .trim(),
        gitlensLineHighlightOverviewRulerColor: computedStyle
            .getPropertyValue('--vscode-gitlens-lineHighlightOverviewRulerColor')
            .trim(),
        gitlensTrailingLineBackgroundColor: computedStyle
            .getPropertyValue('--vscode-gitlens-trailingLineBackgroundColor')
            .trim(),
        gitlensTrailingLineForegroundColor: computedStyle
            .getPropertyValue('--vscode-gitlens-trailingLineForegroundColor')
            .trim(),
        inputBackground: computedStyle.getPropertyValue('--vscode-input-background').trim(),
        inputForeground: computedStyle.getPropertyValue('--vscode-input-foreground').trim(),
        inputPlaceholderForeground: computedStyle.getPropertyValue('--vscode-input-placeholderForeground').trim(),
        inputOptionActiveBorder: computedStyle.getPropertyValue('--vscode-inputOption-activeBorder').trim(),
        inputValidationErrorBackground: computedStyle
            .getPropertyValue('--vscode-inputValidation-errorBackground')
            .trim(),
        inputValidationErrorBorder: computedStyle.getPropertyValue('--vscode-inputValidation-errorBorder').trim(),
        inputValidationInfoBackground: computedStyle.getPropertyValue('--vscode-inputValidation-infoBackground').trim(),
        inputValidationInfoBorder: computedStyle.getPropertyValue('--vscode-inputValidation-infoBorder').trim(),
        inputValidationWarningBackground: computedStyle
            .getPropertyValue('--vscode-inputValidation-warningBackground')
            .trim(),
        inputValidationWarningBorder: computedStyle.getPropertyValue('--vscode-inputValidation-warningBorder').trim(),
        listActiveSelectionBackground: computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground').trim(),
        listActiveSelectionForeground: computedStyle.getPropertyValue('--vscode-list-activeSelectionForeground').trim(),
        listDropBackground: computedStyle.getPropertyValue('--vscode-list-dropBackground').trim(),
        listErrorForeground: computedStyle.getPropertyValue('--vscode-list-errorForeground').trim(),
        listFocusBackground: computedStyle.getPropertyValue('--vscode-list-focusBackground').trim(),
        listHighlightForeground: computedStyle.getPropertyValue('--vscode-list-highlightForeground').trim(),
        listHoverBackground: computedStyle.getPropertyValue('--vscode-list-hoverBackground').trim(),
        listInactiveSelectionBackground: computedStyle
            .getPropertyValue('--vscode-list-inactiveSelectionBackground')
            .trim(),
        listInvalidItemForeground: computedStyle.getPropertyValue('--vscode-list-invalidItemForeground').trim(),
        listWarningForeground: computedStyle.getPropertyValue('--vscode-list-warningForeground').trim(),
        listFilterWidgetBackground: computedStyle.getPropertyValue('--vscode-listFilterWidget-background').trim(),
        listFilterWidgetNoMatchesOutline: computedStyle
            .getPropertyValue('--vscode-listFilterWidget-noMatchesOutline')
            .trim(),
        listFilterWidgetOutline: computedStyle.getPropertyValue('--vscode-listFilterWidget-outline').trim(),
        menuBackground: computedStyle.getPropertyValue('--vscode-menu-background').trim(),
        menuForeground: computedStyle.getPropertyValue('--vscode-menu-foreground').trim(),
        menuSelectionBackground: computedStyle.getPropertyValue('--vscode-menu-selectionBackground').trim(),
        menuSelectionForeground: computedStyle.getPropertyValue('--vscode-menu-selectionForeground').trim(),
        menuSeparatorBackground: computedStyle.getPropertyValue('--vscode-menu-separatorBackground').trim(),
        menubarSelectionBackground: computedStyle.getPropertyValue('--vscode-menubar-selectionBackground').trim(),
        menubarSelectionForeground: computedStyle.getPropertyValue('--vscode-menubar-selectionForeground').trim(),
        mergeCommonContentBackground: computedStyle.getPropertyValue('--vscode-merge-commonContentBackground').trim(),
        mergeCommonHeaderBackground: computedStyle.getPropertyValue('--vscode-merge-commonHeaderBackground').trim(),
        mergeCurrentContentBackground: computedStyle.getPropertyValue('--vscode-merge-currentContentBackground').trim(),
        mergeCurrentHeaderBackground: computedStyle.getPropertyValue('--vscode-merge-currentHeaderBackground').trim(),
        mergeIncomingContentBackground: computedStyle
            .getPropertyValue('--vscode-merge-incomingContentBackground')
            .trim(),
        mergeIncomingHeaderBackground: computedStyle.getPropertyValue('--vscode-merge-incomingHeaderBackground').trim(),
        notificationCenterHeaderBackground: computedStyle
            .getPropertyValue('--vscode-notificationCenterHeader-background')
            .trim(),
        notificationLinkForeground: computedStyle.getPropertyValue('--vscode-notificationLink-foreground').trim(),
        notificationsBackground: computedStyle.getPropertyValue('--vscode-notifications-background').trim(),
        notificationsBorder: computedStyle.getPropertyValue('--vscode-notifications-border').trim(),
        panelBackground: computedStyle.getPropertyValue('--vscode-panel-background').trim(),
        panelBorder: computedStyle.getPropertyValue('--vscode-panel-border').trim(),
        panelDropBackground: computedStyle.getPropertyValue('--vscode-panel-dropBackground').trim(),
        panelInputBorder: computedStyle.getPropertyValue('--vscode-panelInput-border').trim(),
        panelTitleActiveBorder: computedStyle.getPropertyValue('--vscode-panelTitle-activeBorder').trim(),
        panelTitleActiveForeground: computedStyle.getPropertyValue('--vscode-panelTitle-activeForeground').trim(),
        panelTitleInactiveForeground: computedStyle.getPropertyValue('--vscode-panelTitle-inactiveForeground').trim(),
        peekViewBorder: computedStyle.getPropertyValue('--vscode-peekView-border').trim(),
        peekViewEditorBackground: computedStyle.getPropertyValue('--vscode-peekViewEditor-background').trim(),
        peekViewEditorMatchHighlightBackground: computedStyle
            .getPropertyValue('--vscode-peekViewEditor-matchHighlightBackground')
            .trim(),
        peekViewEditorGutterBackground: computedStyle
            .getPropertyValue('--vscode-peekViewEditorGutter-background')
            .trim(),
        peekViewResultBackground: computedStyle.getPropertyValue('--vscode-peekViewResult-background').trim(),
        peekViewResultFileForeground: computedStyle.getPropertyValue('--vscode-peekViewResult-fileForeground').trim(),
        peekViewResultLineForeground: computedStyle.getPropertyValue('--vscode-peekViewResult-lineForeground').trim(),
        peekViewResultMatchHighlightBackground: computedStyle
            .getPropertyValue('--vscode-peekViewResult-matchHighlightBackground')
            .trim(),
        peekViewResultSelectionBackground: computedStyle
            .getPropertyValue('--vscode-peekViewResult-selectionBackground')
            .trim(),
        peekViewResultSelectionForeground: computedStyle
            .getPropertyValue('--vscode-peekViewResult-selectionForeground')
            .trim(),
        peekViewTitleBackground: computedStyle.getPropertyValue('--vscode-peekViewTitle-background').trim(),
        peekViewTitleDescriptionForeground: computedStyle
            .getPropertyValue('--vscode-peekViewTitleDescription-foreground')
            .trim(),
        peekViewTitleLabelForeground: computedStyle.getPropertyValue('--vscode-peekViewTitleLabel-foreground').trim(),
        pickerGroupBorder: computedStyle.getPropertyValue('--vscode-pickerGroup-border').trim(),
        pickerGroupForeground: computedStyle.getPropertyValue('--vscode-pickerGroup-foreground').trim(),
        progressBarBackground: computedStyle.getPropertyValue('--vscode-progressBar-background').trim(),
        quickInputBackground: computedStyle.getPropertyValue('--vscode-quickInput-background').trim(),
        scrollbarShadow: computedStyle.getPropertyValue('--vscode-scrollbar-shadow').trim(),
        scrollbarSliderActiveBackground: computedStyle
            .getPropertyValue('--vscode-scrollbarSlider-activeBackground')
            .trim(),
        scrollbarSliderBackground: computedStyle.getPropertyValue('--vscode-scrollbarSlider-background').trim(),
        scrollbarSliderHoverBackground: computedStyle
            .getPropertyValue('--vscode-scrollbarSlider-hoverBackground')
            .trim(),
        settingsCheckboxBackground: computedStyle.getPropertyValue('--vscode-settings-checkboxBackground').trim(),
        settingsCheckboxBorder: computedStyle.getPropertyValue('--vscode-settings-checkboxBorder').trim(),
        settingsDropdownBackground: computedStyle.getPropertyValue('--vscode-settings-dropdownBackground').trim(),
        settingsDropdownBorder: computedStyle.getPropertyValue('--vscode-settings-dropdownBorder').trim(),
        settingsDropdownListBorder: computedStyle.getPropertyValue('--vscode-settings-dropdownListBorder').trim(),
        settingsHeaderForeground: computedStyle.getPropertyValue('--vscode-settings-headerForeground').trim(),
        settingsModifiedItemIndicator: computedStyle.getPropertyValue('--vscode-settings-modifiedItemIndicator').trim(),
        settingsNumberInputBackground: computedStyle.getPropertyValue('--vscode-settings-numberInputBackground').trim(),
        settingsNumberInputBorder: computedStyle.getPropertyValue('--vscode-settings-numberInputBorder').trim(),
        settingsNumberInputForeground: computedStyle.getPropertyValue('--vscode-settings-numberInputForeground').trim(),
        settingsTextInputBackground: computedStyle.getPropertyValue('--vscode-settings-textInputBackground').trim(),
        settingsTextInputBorder: computedStyle.getPropertyValue('--vscode-settings-textInputBorder').trim(),
        settingsTextInputForeground: computedStyle.getPropertyValue('--vscode-settings-textInputForeground').trim(),
        sideBarBackground: computedStyle.getPropertyValue('--vscode-sideBar-background').trim(),
        sideBarDropBackground: computedStyle.getPropertyValue('--vscode-sideBar-dropBackground').trim(),
        sideBarSectionHeaderBackground: computedStyle
            .getPropertyValue('--vscode-sideBarSectionHeader-background')
            .trim(),
        sideBarTitleForeground: computedStyle.getPropertyValue('--vscode-sideBarTitle-foreground').trim(),
        statusBarBackground: computedStyle.getPropertyValue('--vscode-statusBar-background').trim(),
        statusBarDebuggingBackground: computedStyle.getPropertyValue('--vscode-statusBar-debuggingBackground').trim(),
        statusBarDebuggingForeground: computedStyle.getPropertyValue('--vscode-statusBar-debuggingForeground').trim(),
        statusBarForeground: computedStyle.getPropertyValue('--vscode-statusBar-foreground').trim(),
        statusBarNoFolderBackground: computedStyle.getPropertyValue('--vscode-statusBar-noFolderBackground').trim(),
        statusBarNoFolderForeground: computedStyle.getPropertyValue('--vscode-statusBar-noFolderForeground').trim(),
        statusBarItemActiveBackground: computedStyle.getPropertyValue('--vscode-statusBarItem-activeBackground').trim(),
        statusBarItemHoverBackground: computedStyle.getPropertyValue('--vscode-statusBarItem-hoverBackground').trim(),
        statusBarItemProminentBackground: computedStyle
            .getPropertyValue('--vscode-statusBarItem-prominentBackground')
            .trim(),
        statusBarItemProminentForeground: computedStyle
            .getPropertyValue('--vscode-statusBarItem-prominentForeground')
            .trim(),
        statusBarItemProminentHoverBackground: computedStyle
            .getPropertyValue('--vscode-statusBarItem-prominentHoverBackground')
            .trim(),
        statusBarItemRemoteBackground: computedStyle.getPropertyValue('--vscode-statusBarItem-remoteBackground').trim(),
        statusBarItemRemoteForeground: computedStyle.getPropertyValue('--vscode-statusBarItem-remoteForeground').trim(),
        tabActiveBackground: computedStyle.getPropertyValue('--vscode-tab-activeBackground').trim(),
        tabActiveForeground: computedStyle.getPropertyValue('--vscode-tab-activeForeground').trim(),
        tabActiveModifiedBorder: computedStyle.getPropertyValue('--vscode-tab-activeModifiedBorder').trim(),
        tabBorder: computedStyle.getPropertyValue('--vscode-tab-border').trim(),
        tabInactiveBackground: computedStyle.getPropertyValue('--vscode-tab-inactiveBackground').trim(),
        tabInactiveForeground: computedStyle.getPropertyValue('--vscode-tab-inactiveForeground').trim(),
        tabInactiveModifiedBorder: computedStyle.getPropertyValue('--vscode-tab-inactiveModifiedBorder').trim(),
        tabUnfocusedActiveBackground: computedStyle.getPropertyValue('--vscode-tab-unfocusedActiveBackground').trim(),
        tabUnfocusedActiveForeground: computedStyle.getPropertyValue('--vscode-tab-unfocusedActiveForeground').trim(),
        tabUnfocusedActiveModifiedBorder: computedStyle
            .getPropertyValue('--vscode-tab-unfocusedActiveModifiedBorder')
            .trim(),
        tabUnfocusedInactiveForeground: computedStyle
            .getPropertyValue('--vscode-tab-unfocusedInactiveForeground')
            .trim(),
        tabUnfocusedInactiveModifiedBorder: computedStyle
            .getPropertyValue('--vscode-tab-unfocusedInactiveModifiedBorder')
            .trim(),
        terminalAnsiBlack: computedStyle.getPropertyValue('--vscode-terminal-ansiBlack').trim(),
        terminalAnsiBlue: computedStyle.getPropertyValue('--vscode-terminal-ansiBlue').trim(),
        terminalAnsiBrightBlack: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightBlack').trim(),
        terminalAnsiBrightBlue: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightBlue').trim(),
        terminalAnsiBrightCyan: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightCyan').trim(),
        terminalAnsiBrightGreen: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightGreen').trim(),
        terminalAnsiBrightMagenta: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightMagenta').trim(),
        terminalAnsiBrightRed: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightRed').trim(),
        terminalAnsiBrightWhite: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightWhite').trim(),
        terminalAnsiBrightYellow: computedStyle.getPropertyValue('--vscode-terminal-ansiBrightYellow').trim(),
        terminalAnsiCyan: computedStyle.getPropertyValue('--vscode-terminal-ansiCyan').trim(),
        terminalAnsiGreen: computedStyle.getPropertyValue('--vscode-terminal-ansiGreen').trim(),
        terminalAnsiMagenta: computedStyle.getPropertyValue('--vscode-terminal-ansiMagenta').trim(),
        terminalAnsiRed: computedStyle.getPropertyValue('--vscode-terminal-ansiRed').trim(),
        terminalAnsiWhite: computedStyle.getPropertyValue('--vscode-terminal-ansiWhite').trim(),
        terminalAnsiYellow: computedStyle.getPropertyValue('--vscode-terminal-ansiYellow').trim(),
        terminalBackground: computedStyle.getPropertyValue('--vscode-terminal-background').trim(),
        terminalBorder: computedStyle.getPropertyValue('--vscode-terminal-border').trim(),
        terminalForeground: computedStyle.getPropertyValue('--vscode-terminal-foreground').trim(),
        terminalSelectionBackground: computedStyle.getPropertyValue('--vscode-terminal-selectionBackground').trim(),
        textBlockQuoteBackground: computedStyle.getPropertyValue('--vscode-textBlockQuote-background').trim(),
        textBlockQuoteBorder: computedStyle.getPropertyValue('--vscode-textBlockQuote-border').trim(),
        textCodeBlockBackground: computedStyle.getPropertyValue('--vscode-textCodeBlock-background').trim(),
        textLinkActiveForeground: computedStyle.getPropertyValue('--vscode-textLink-activeForeground').trim(),
        textLinkForeground: computedStyle.getPropertyValue('--vscode-textLink-foreground').trim(),
        textPreformatForeground: computedStyle.getPropertyValue('--vscode-textPreformat-foreground').trim(),
        textSeparatorForeground: computedStyle.getPropertyValue('--vscode-textSeparator-foreground').trim(),
        titleBarActiveBackground: computedStyle.getPropertyValue('--vscode-titleBar-activeBackground').trim(),
        titleBarActiveForeground: computedStyle.getPropertyValue('--vscode-titleBar-activeForeground').trim(),
        titleBarInactiveBackground: computedStyle.getPropertyValue('--vscode-titleBar-inactiveBackground').trim(),
        titleBarInactiveForeground: computedStyle.getPropertyValue('--vscode-titleBar-inactiveForeground').trim(),
        treeIndentGuidesStroke: computedStyle.getPropertyValue('--vscode-tree-indentGuidesStroke').trim(),
        widgetShadow: computedStyle.getPropertyValue('--vscode-widget-shadow').trim(),
        editorLineHighlightBackground: computedStyle.getPropertyValue('--vscode-editor-lineHighlightBackground').trim(),
        selectionBackground: computedStyle.getPropertyValue('--vscode-selection-background').trim(),
        walkThroughEmbeddedEditorBackground: computedStyle
            .getPropertyValue('--vscode-walkThrough-embeddedEditorBackground')
            .trim(),
        dropdownForeground: computedStyle.getPropertyValue('--vscode-dropdown-foreground').trim(),
        settingsCheckboxForeground: computedStyle.getPropertyValue('--vscode-settings-checkboxForeground').trim(),
        settingsDropdownForeground: computedStyle.getPropertyValue('--vscode-settings-dropdownForeground').trim(),
    };
};
