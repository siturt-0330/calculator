import { forwardRef, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import BottomSheetLib, {
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { C } from '../../design/tokens';

type Props = {
  snapPoints?: (string | number)[];
  children: React.ReactNode;
};

export const BottomSheet = forwardRef<BottomSheetLib, Props>(
  ({ snapPoints = ['50%', '90%'], children }, ref) => {
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      [],
    );

    return (
      <BottomSheetLib
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: C.bg2 }}
        handleIndicatorStyle={{ backgroundColor: C.border2 }}
      >
        <BottomSheetView style={StyleSheet.absoluteFillObject}>{children}</BottomSheetView>
      </BottomSheetLib>
    );
  },
);

BottomSheet.displayName = 'BottomSheet';
