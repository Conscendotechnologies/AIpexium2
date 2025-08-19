import React from 'react';
type PipelinesExplorerOptionsProps = {
    enableItem: React.ReactElement;
    monitorItem: React.ReactElement;
    hideEmptyItem: React.ReactElement;
    hideFilteredItem: React.ReactElement;
    intervalItem: React.ReactElement;
};

export const PipelinesExplorerOptions: React.FunctionComponent<PipelinesExplorerOptionsProps> = ({
    enableItem,
    monitorItem,
    hideEmptyItem,
    hideFilteredItem,
    intervalItem,
}) => {
    return (
        <>
            {enableItem}
            {monitorItem}
            {hideEmptyItem}
            {hideFilteredItem}
            {intervalItem}
        </>
    );
};
