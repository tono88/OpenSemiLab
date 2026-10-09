-- Autocheck: reset, enable, GPIO y duty 64/256. Termina con std.env.stop.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_top is end entity;
architecture sim of tb_top is
  signal clk : std_logic := '0';
  signal rst_n, enable, write_en : std_logic := '0';
  signal gpio_data : std_logic_vector(7 downto 0) := (others => '0');
  signal gpio_out, count : std_logic_vector(7 downto 0);
  signal led, pwm_led : std_logic;
begin
  dut: entity work.top generic map(BLINK_BITS => 4)
    port map(clk, rst_n, enable, write_en, gpio_data, gpio_out, count, led, pwm_led);
  clk <= not clk after 5 ns;
  process
    variable held_count : std_logic_vector(7 downto 0);
    variable high_cycles : natural := 0;
  begin
    wait for 12 ns;
    assert count=x"00" and gpio_out=x"00" and pwm_led='0' report "Reset failed" severity failure;
    wait until falling_edge(clk); rst_n <= '1'; enable <= '1';
    gpio_data <= x"40"; write_en <= '1';
    wait until falling_edge(clk); write_en <= '0';
    assert gpio_out=x"40" report "GPIO write failed" severity failure;
    for i in 1 to 256 loop
      wait until falling_edge(clk);
      if pwm_led='1' then high_cycles := high_cycles + 1; end if;
    end loop;
    assert high_cycles=64 report "PWM duty mismatch" severity failure;
    enable <= '0'; held_count := count;
    for i in 1 to 5 loop
      wait until falling_edge(clk);
      assert count=held_count report "Enable did not hold counter" severity failure;
    end loop;
    rst_n <= '0'; wait for 1 ns;
    assert count=x"00" and gpio_out=x"00" and led='0' report "Mid-run reset failed" severity failure;
    report "PASS VHDL GPIO, counter enable, PWM duty and reset";
    std.env.stop;
    wait;
  end process;
  process begin wait for 10 us; assert false report "Simulation timeout" severity failure; end process;
end architecture;
