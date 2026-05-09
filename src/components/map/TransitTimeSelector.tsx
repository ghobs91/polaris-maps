import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../contexts/ThemeContext';
import { useTransitStore } from '../../stores/transitStore';

export default function TransitTimeSelector() {
  const { colors, isDark } = useTheme();

  const departureTime = useTransitStore((s) => s.departureTime);
  const isDepartAt = useTransitStore((s) => s.isDepartAt);
  const setDepartureTime = useTransitStore((s) => s.setDepartureTime);
  const setIsDepartAt = useTransitStore((s) => s.setIsDepartAt);

  const [showPicker, setShowPicker] = useState(false);

  const selectedTime = departureTime ?? new Date();

  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    const m = minutes.toString().padStart(2, '0');
    return `${h}:${m} ${ampm}`;
  };

  const isToday = (() => {
    const now = new Date();
    return (
      selectedTime.getFullYear() === now.getFullYear() &&
      selectedTime.getMonth() === now.getMonth() &&
      selectedTime.getDate() === now.getDate()
    );
  })();

  const handleTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    // On Android, the picker auto-closes; on iOS it stays open until dismissed
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (date) {
        setDepartureTime(date);
      }
    } else {
      if (date) {
        setDepartureTime(date);
      }
    }
  };

  const handleResetToNow = () => {
    setDepartureTime(null);
    setIsDepartAt(true);
  };

  const timeLabel = departureTime
    ? isToday
      ? formatTime(selectedTime)
      : formatTime(selectedTime) + ' (other day)'
    : 'Now';

  return (
    <View style={styles.container}>
      {/* Depart / Arrive toggle */}
      <View
        style={[
          styles.toggleRow,
          { backgroundColor: isDark ? 'rgba(50,50,70,0.5)' : 'rgba(0,0,0,0.04)' },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.toggleBtn,
            isDepartAt && {
              backgroundColor: colors.primary,
            },
          ]}
          onPress={() => setIsDepartAt(true)}
        >
          <Text
            style={[
              styles.toggleText,
              { color: isDepartAt ? '#fff' : colors.textSecondary },
            ]}
          >
            Depart
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleBtn,
            !isDepartAt && {
              backgroundColor: colors.primary,
            },
          ]}
          onPress={() => setIsDepartAt(false)}
        >
          <Text
            style={[
              styles.toggleText,
              { color: !isDepartAt ? '#fff' : colors.textSecondary },
            ]}
          >
            Arrive
          </Text>
        </TouchableOpacity>
      </View>

      {/* Time display + picker */}
      <TouchableOpacity
        style={[
          styles.timeBtn,
          { backgroundColor: isDark ? 'rgba(50,50,70,0.5)' : 'rgba(0,0,0,0.04)' },
        ]}
        onPress={() => setShowPicker(true)}
      >
        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>
          {isDepartAt ? 'at' : 'by'}
        </Text>
        <Text style={[styles.timeValue, { color: colors.primary }]}>
          {timeLabel}
        </Text>
      </TouchableOpacity>

      {/* Reset to now */}
      {departureTime && (
        <TouchableOpacity
          style={[
            styles.resetBtn,
            { backgroundColor: isDark ? 'rgba(50,50,70,0.5)' : 'rgba(0,0,0,0.04)' },
          ]}
          onPress={handleResetToNow}
        >
          <Text style={[styles.resetText, { color: colors.textSecondary }]}>Now</Text>
        </TouchableOpacity>
      )}

      {/* Native time picker */}
      {showPicker && (
        <DateTimePicker
          value={selectedTime}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
          minimumDate={new Date()}
          themeVariant={isDark ? 'dark' : 'light'}
          textColor={colors.text}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  timeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  timeLabel: {
    fontSize: 13,
  },
  timeValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  resetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  resetText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
